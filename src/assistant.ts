// Помощник: понимает короткие фразы о деньгах без нейросети — по ключевым словам и шаблонам.
// Все цифры считает приложение по операциям, поэтому ответы точные. Вопросы вне шаблонов он честно не понимает.
import { accountLabel, defaultAccount, isDebtKind } from './accountKinds'
import { addDays, formatDate, isoDate, shiftMonth } from './dates'
import type { Account, Category, Data, TxType } from './db'
import { dailyBudget, expensesBetween, payoff, tips } from './insights'
import { formatAmount, formatRate } from './money'
import { graceToPay } from './payments'
import { accountBalances, mainCurrency } from './stats'
import { daysUntil } from './subscriptions'

/** Черновик операции, который помощник предлагает записать. */
export interface Draft {
  type: TxType
  amount: number
  accountId: string
  toAccountId: string | null
  toAmount: null
  categoryId: string | null
  date: string
  note: string
}

export interface Reply {
  text: string[]
  /** Строки «название — сумма» с пояснением. */
  rows?: { label: string; value: string; hint?: string }[]
  /** Разделы с примерами команд: по нажатию пример отправляется как вопрос. */
  sections?: { title: string; items: string[] }[]
  draft?: Draft
  /** Кнопки-подсказки для следующего вопроса. */
  chips?: string[]
}

type Ctx = Data & { today: string }

// ——— Разбор текста ———

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

/** Есть ли в тексте отдельное слово: \b в регулярных выражениях JS не понимает кириллицу. */
const hasWord = (low: string, word: string) => new RegExp(`(?<![а-яa-z])(?:${word})(?![а-яa-z])`).test(low)

/** Слова текста как они написаны и в нижнем регистре. */
function words(text: string): { raw: string; low: string }[] {
  return [...text.matchAll(/[a-zA-Zа-яА-ЯёЁ]+/g)].map((m) => ({ raw: m[0], low: norm(m[0]) }))
}

/**
 * Одно ли это слово в разных формах: «альфы» и «Альфа», «кофе» и «кофейня».
 * Совпасть должно начало слова, отличаться — не больше двух последних букв короткого.
 */
export function sameRoot(a: string, b: string): boolean {
  if (a === b) return true
  const short = Math.min(a.length, b.length)
  if (short < 4) return false
  let common = 0
  while (common < short && a[common] === b[common]) common++
  return common >= Math.max(3, short - 2)
}

const hasRoot = (list: { low: string }[], ...roots: string[]) => list.some((w) => roots.some((r) => w.low.startsWith(r)))

/** Сумма из текста: «250», «1 240,50», «3к», «90 тыс». Даты вида 12.10 сюда не попадают. */
export function parseMoney(text: string): number | null {
  const cleaned = norm(text).replace(/\b\d{1,2}\.\d{1,2}(\.\d{2,4})?\b/g, ' ')
  const m = /(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(к|k|тыс[а-я]*|т)?(?![\dа-я])/.exec(cleaned)
  if (!m) return null
  const whole = Number(m[1].replace(/[  ]/g, ''))
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0
  const minor = whole * 100 + frac
  return m[3] ? minor * 1000 : minor
}

/** Дата операции из текста: «вчера», «позавчера», «12.10», «12.10.26»; по умолчанию сегодня. */
export function parseDay(text: string, today: string): string {
  const low = norm(text)
  if (hasWord(low, 'позавчера')) return addDays(today, -2)
  if (hasWord(low, 'вчера')) return addDays(today, -1)
  const m = /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/.exec(low)
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4))
    const date = new Date(year, Number(m[2]) - 1, Number(m[1]))
    if (date.getDate() === Number(m[1])) {
      const iso = isoDate(date)
      // Без года дата из будущего — это прошлый год: «28.12», сказанное в январе.
      return !m[3] && iso > today ? isoDate(new Date(year - 1, Number(m[2]) - 1, Number(m[1]))) : iso
    }
  }
  return today
}

const MONTHS: [RegExp, string, string][] = [
  [/^янв/, 'январь', 'январе'],
  [/^фев/, 'февраль', 'феврале'],
  [/^мар/, 'март', 'марте'],
  [/^апр/, 'апрель', 'апреле'],
  [/^ма[йяе]$/, 'май', 'мае'],
  [/^июн/, 'июнь', 'июне'],
  [/^июл/, 'июль', 'июле'],
  [/^авг/, 'август', 'августе'],
  [/^сен/, 'сентябрь', 'сентябре'],
  [/^окт/, 'октябрь', 'октябре'],
  [/^ноя/, 'ноябрь', 'ноябре'],
  [/^дек/, 'декабрь', 'декабре'],
]

export interface Range {
  from: string
  to: string
  label: string
}

const lastOfMonth = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1)
const monthIn = (month: string) => MONTHS[Number(month.slice(5)) - 1][2]

/** Период вопроса: сегодня, вчера, неделя, этот или прошлый месяц, названный месяц, N месяцев, год. */
export function parseRange(text: string, today: string): Range {
  const low = norm(text)
  const month = today.slice(0, 7)
  if (hasWord(low, 'сегодня')) return { from: today, to: today, label: 'сегодня' }
  if (hasWord(low, 'вчера')) return { from: addDays(today, -1), to: addDays(today, -1), label: 'вчера' }
  if (/недел/.test(low)) return { from: addDays(today, -6), to: today, label: 'за последние 7 дней' }
  if (/прошл[а-я]* месяц/.test(low)) {
    const m = shiftMonth(month, -1)
    return { from: `${m}-01`, to: lastOfMonth(m), label: `в прошлом месяце (${monthIn(m)})` }
  }
  if (/полгода/.test(low)) return { from: `${shiftMonth(month, -5)}-01`, to: today, label: 'за полгода' }
  if (hasWord(low, 'год')) return { from: `${shiftMonth(month, -11)}-01`, to: today, label: 'за год' }
  const n = /(?:за|последние)\s+(\d+|два|три|четыре|пять|шесть)\s+месяц/.exec(low)
  if (n) {
    const count = Number(n[1]) || { два: 2, три: 3, четыре: 4, пять: 5, шесть: 6 }[n[1]]!
    return { from: `${shiftMonth(month, -(count - 1))}-01`, to: today, label: `за ${count} мес. (с ${monthIn(shiftMonth(month, -(count - 1)))})` }
  }
  for (const w of words(text)) {
    const index = MONTHS.findIndex(([re]) => re.test(w.low))
    if (index === -1) continue
    let m = `${today.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`
    if (m > month) m = shiftMonth(m, -12)
    return { from: `${m}-01`, to: m === month ? today : lastOfMonth(m), label: `в ${MONTHS[index][2]}` }
  }
  return { from: `${month}-01`, to: today, label: `в ${monthIn(month)}` }
}

/** Ключевые слова стандартных категорий, по которым угадывается категория операции. */
const CATEGORY_WORDS: [string, string[]][] = [
  ['default-food', ['продукты', 'магазин', 'супермаркет', 'пятерочка', 'магнит', 'перекресток', 'вкусвилл', 'лента', 'ашан', 'дикси', 'хлеб', 'молоко', 'еда']],
  ['default-cafe', ['кафе', 'кофе', 'кофейня', 'ресторан', 'обед', 'ужин', 'завтрак', 'бургер', 'пицца', 'шаурма', 'суши', 'доставка']],
  ['default-transport', ['такси', 'метро', 'автобус', 'транспорт', 'бензин', 'заправка', 'топливо', 'проезд', 'электричка', 'парковка', 'каршеринг']],
  ['default-housing', ['аренда', 'квартира', 'жкх', 'коммуналка', 'квартплата', 'свет', 'электричество', 'интернет', 'ремонт']],
  ['default-health', ['аптека', 'лекарства', 'врач', 'больница', 'анализы', 'стоматолог', 'здоровье']],
  ['default-fun', ['кино', 'игры', 'игра', 'концерт', 'театр', 'развлечения', 'бар', 'боулинг']],
  ['default-subscriptions', ['подписка', 'музыка', 'спотифай', 'плюс', 'нетфликс']],
  ['default-interest', ['проценты']],
  ['default-salary', ['зарплата', 'зп', 'аванс', 'премия', 'оклад']],
  ['default-other-income', ['кэшбэк', 'кешбек', 'возврат', 'подарок']],
]

const INCOME_WORDS = ['зарплат', 'зп', 'аванс', 'преми', 'пришл', 'получил', 'доход', 'кэшбэк', 'кешбек', 'возврат', 'заработал', 'продал']
const TRANSFER_WORDS = ['перевод', 'перевел', 'перекинул', 'перечислил', 'погасил', 'погашение', 'внес', 'взнос', 'пополнил']
const SERVICE = new Set(['с', 'со', 'на', 'за', 'в', 'во', 'по', 'из', 'от', 'и', 'руб', 'рублей', 'рубля', 'р', 'к', 'т', 'тыс', 'сегодня', 'вчера', 'позавчера'])

/** Счета, названные в тексте, в порядке упоминания. */
function mentionedAccounts(list: { low: string }[], accounts: Account[]): { account: Account; index: number }[] {
  const out: { account: Account; index: number }[] = []
  list.forEach((w, index) => {
    for (const a of accounts) {
      const nameWords = words(a.name).map((n) => n.low)
      if (nameWords.some((n) => sameRoot(w.low, n)) && !out.some((o) => o.account === a)) out.push({ account: a, index })
    }
  })
  return out
}

/** Категория по словам текста: название категории, прошлые операции с таким комментарием, словарь. */
function guessCategory(list: { low: string }[], categories: Category[], ctx: Ctx): Category | undefined {
  const content = list.filter((w) => !SERVICE.has(w.low) && w.low.length >= 2)
  for (const w of content) {
    const byName = categories.find((c) => words(c.name).some((n) => sameRoot(w.low, n.low)))
    if (byName) return byName
  }
  // Как пользователь сам относил операции с этим словом в комментарии.
  const votes = new Map<string, number>()
  for (const t of ctx.transactions) {
    if (!t.categoryId || !t.note) continue
    const noteWords = words(t.note).map((n) => n.low)
    if (content.some((w) => noteWords.some((n) => sameRoot(w.low, n)))) votes.set(t.categoryId, (votes.get(t.categoryId) ?? 0) + 1)
  }
  const voted = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0]
  const learned = voted && categories.find((c) => c.id === voted)
  if (learned) return learned
  for (const [id, keys] of CATEGORY_WORDS) {
    if (content.some((w) => keys.some((k) => sameRoot(w.low, k)))) {
      const found = categories.find((c) => c.id === id)
      if (found) return found
    }
  }
  return undefined
}

/** Черновик операции из фразы вроде «кофе 250», «вчера такси 600 с кредитки», «перевод 5000 с карты на накопления». */
export function parseOperation(text: string, ctx: Ctx): Draft | null {
  const amount = parseMoney(text)
  if (!amount) return null
  const list = words(text)
  const accounts = mentionedAccounts(list, ctx.accounts)
  const fallback = defaultAccount(ctx.accounts)
  if (!fallback) return null

  const transferWord = hasRoot(list, ...TRANSFER_WORDS)
  const toIndex = list.findIndex((w) => w.low === 'на')
  let type: TxType = 'expense'
  let from = fallback
  let to: Account | null = null
  if (transferWord || accounts.length >= 2) {
    // Счёт после «на» — куда; остальной названный — откуда.
    const target = accounts.find((m) => toIndex !== -1 && m.index > toIndex) ?? (accounts.length >= 2 ? accounts[1] : accounts[0])
    const source = accounts.find((m) => m !== target)
    if (target) {
      type = 'transfer'
      to = target.account
      from = source?.account ?? (fallback.id === target.account.id ? (ctx.accounts.find((a) => a.id !== target.account.id) ?? fallback) : fallback)
    }
  } else if (accounts.length === 1) {
    from = accounts[0].account
  }

  // Слова-названия счетов в категорию не идут: «с кредитки» — не «Проценты по кредитам».
  const accountWords = new Set(accounts.map((m) => m.index))
  let category: Category | undefined
  if (type !== 'transfer') {
    category = guessCategory(list.filter((_, i) => !accountWords.has(i)), ctx.categories, ctx)
    if (category?.kind === 'income' || (!category && hasRoot(list, ...INCOME_WORDS))) type = 'income'
    if (category && category.kind !== type) category = undefined
  }

  const note = list
    .filter((w, i) => !accountWords.has(i) && !SERVICE.has(w.low) && !(type === 'transfer' && hasRoot([w], ...TRANSFER_WORDS)))
    .map((w) => w.raw)
    .join(' ')
  return {
    type,
    amount,
    accountId: from.id,
    toAccountId: to?.id ?? null,
    toAmount: null,
    categoryId: category?.id ?? null,
    date: parseDay(text, ctx.today),
    note: note && note.toLowerCase() !== category?.name.toLowerCase() ? note[0].toUpperCase() + note.slice(1) : '',
  }
}

// ——— Ответы ———

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

const HELP_SECTIONS: { title: string; items: string[] }[] = [
  { title: 'Записать операцию', items: ['кофе 250', 'вчера такси 600 с кредитки', 'зарплата 90000', 'перевод 5000 на накопления', 'погасил кредитку 10000'] },
  { title: 'Траты и доходы', items: ['сколько потратил на кафе', 'расходы за прошлый месяц', 'сколько ушло на продукты в сентябре', 'доходы за 3 месяца', 'на что больше всего ушло', 'сравни с прошлым месяцем'] },
  { title: 'Планирование', items: ['сколько можно тратить в день', 'что спишется на неделе', 'когда закрою кредит', 'что если вносить на 5000 больше'] },
  { title: 'Счета и советы', items: ['баланс', 'сколько на карте', 'советы'] },
]

export const GREETING: Reply = {
  text: [
    'Привет! Я помогаю с деньгами: записываю операции фразой и отвечаю на вопросы по твоим тратам.',
    'Напиши, например, «кофе 250» или «сколько потратил на кафе». Все команды — по запросу «что ты можешь».',
  ],
  chips: ['что ты можешь', 'сколько можно тратить в день', 'советы'],
}

function help(ctx: Ctx): Reply {
  // В примерах — настоящие названия счетов, если они есть.
  const loan = ctx.accounts.find((a) => a.kind === 'loan')
  const sections = HELP_SECTIONS.map((s) => ({
    ...s,
    items: s.items.map((i) => (i === 'когда закрою кредит' && loan ? `когда закрою ${loan.name.toLowerCase()}` : i)),
  }))
  return {
    text: [
      'Вот что я умею. Нажми на пример, чтобы попробовать, или напиши своими словами.',
      'Операцию я сначала покажу черновиком: запишу, только когда нажмёшь «Записать».',
    ],
    sections,
  }
}

function spent(text: string, ctx: Ctx, type: 'expense' | 'income'): Reply {
  const range = parseRange(text, ctx.today)
  const currency = mainCurrency(ctx.accounts)
  const money = (m: number) => formatAmount(m, currency)
  const list = words(text).filter((w) => !/^(сколько|потратил[а-я]*|расход[а-я]*|трат[а-я]*|ушло|доход[а-я]*|заработал[а-я]*|получил[а-я]*|месяц[а-я]*|прошл[а-я]*|этом|последние|полгода|год|недел[а-я]*)$/.test(w.low))
  const category = guessCategory(list, ctx.categories.filter((c) => c.kind === type), ctx)
  const result = expensesBetween(ctx.accounts, ctx.transactions, range.from, range.to, type)
  const what = type === 'expense' ? 'Расходы' : 'Доходы'
  if (category) {
    const amount = result.byCategory.get(category.id) ?? 0
    const count = ctx.transactions.filter(
      (t) => t.type === type && t.categoryId === category.id && t.date >= range.from && t.date <= range.to,
    ).length
    return {
      text: [
        amount > 0
          ? `${what} на «${category.name}» ${range.label}: ${money(amount)} — ${count} ${plural(count, 'операция', 'операции', 'операций')}.`
          : `На «${category.name}» ${range.label} ничего не записано.`,
        ...(amount > 0 && result.total > 0 ? [`Это ${Math.round((amount / result.total) * 100)}% всех ${type === 'expense' ? 'расходов' : 'доходов'} за период.`] : []),
      ],
      chips: ['на что больше всего ушло', 'сравни с прошлым месяцем'],
    }
  }
  if (result.count === 0) return { text: [`${what} ${range.label}: ничего не записано.`] }
  return {
    text: [`${what} ${range.label}: ${money(result.total)} — ${result.count} ${plural(result.count, 'операция', 'операции', 'операций')}.`],
    rows: top(result.byCategory, result.total, ctx.categories, currency, 5),
    chips: type === 'expense' ? ['сравни с прошлым месяцем', 'советы'] : ['расходы за этот месяц'],
  }
}

function top(byCategory: Map<string | null, number>, total: number, categories: Category[], currency: string, limit: number) {
  return [...byCategory]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, amount]) => ({
      label: (id && categories.find((c) => c.id === id)?.name) || 'Без категории',
      value: formatAmount(amount, currency),
      hint: `${Math.round((amount / total) * 100)}%`,
    }))
}

function biggest(text: string, ctx: Ctx): Reply {
  const range = parseRange(text, ctx.today)
  const currency = mainCurrency(ctx.accounts)
  const result = expensesBetween(ctx.accounts, ctx.transactions, range.from, range.to)
  if (result.count === 0) return { text: [`Расходов ${range.label} нет.`] }
  return {
    text: [`Больше всего ${range.label} ушло на:`],
    rows: top(result.byCategory, result.total, ctx.categories, currency, 5),
    chips: ['сравни с прошлым месяцем', 'советы'],
  }
}

function compare(ctx: Ctx): Reply {
  const currency = mainCurrency(ctx.accounts)
  const money = (m: number) => formatAmount(m, currency)
  const month = ctx.today.slice(0, 7)
  const prev = shiftMonth(month, -1)
  const day = Number(ctx.today.slice(8))
  // Честное сравнение — с тем же числом прошлого месяца, а не со всем месяцем.
  const prevTo = `${prev}-${String(Math.min(day, Number(lastOfMonth(prev).slice(8)))).padStart(2, '0')}`
  const now = expensesBetween(ctx.accounts, ctx.transactions, `${month}-01`, ctx.today)
  const before = expensesBetween(ctx.accounts, ctx.transactions, `${prev}-01`, prevTo)
  const full = expensesBetween(ctx.accounts, ctx.transactions, `${prev}-01`, lastOfMonth(prev))
  const monthName = (m: string) => MONTHS[Number(m.slice(5)) - 1][1]
  const text = [`С 1 по ${day} число: ${monthName(month)} — ${money(now.total)}, ${monthName(prev)} — ${money(before.total)}.`]
  if (before.total > 0) {
    const diff = Math.round((now.total / before.total - 1) * 100)
    text.push(diff === 0 ? 'Тратишь столько же.' : diff > 0 ? `Это на ${diff}% больше.` : `Это на ${-diff}% меньше.`)
  }
  text.push(`За весь прошлый месяц ушло ${money(full.total)}.`)
  const changes = [...new Set([...now.byCategory.keys(), ...before.byCategory.keys()])]
    .map((id) => ({ id, delta: (now.byCategory.get(id) ?? 0) - (before.byCategory.get(id) ?? 0) }))
    .filter((c) => Math.abs(c.delta) >= 100)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)
  return {
    text,
    rows: changes.map((c) => ({
      label: (c.id && ctx.categories.find((x) => x.id === c.id)?.name) || 'Без категории',
      value: `${c.delta > 0 ? '+' : '−'}${money(Math.abs(c.delta))}`,
      hint: c.delta > 0 ? 'больше' : 'меньше',
    })),
    chips: ['на что больше всего ушло', 'советы'],
  }
}

function perDay(ctx: Ctx): Reply {
  const balances = accountBalances(ctx.accounts, ctx.transactions)
  const b = dailyBudget(ctx.accounts, balances, ctx.subscriptions, ctx.today)
  const money = (m: number) => formatAmount(m, b.currency)
  const untilText = b.payday ? `до дохода ${formatDate(b.until)}` : 'до конца месяца'
  const text =
    b.free < 0
      ? [`${untilText[0].toUpperCase()}${untilText.slice(1)} на обязательные платежи не хватает ${money(-b.free)}. Свободных денег на траты нет.`]
      : [`Можно тратить около ${money(b.perDay)} в день ${untilText} (${b.days} ${plural(b.days, 'день', 'дня', 'дней')}).`]
  if (!b.payday) text.push('Чтобы считать до зарплаты, добавь её в «Регулярные» как доход.')
  return {
    text,
    rows: [
      { label: 'На обычных счетах', value: money(b.available) },
      ...b.obligations.map((o) => ({ label: o.title, value: `−${money(o.amount)}`, hint: formatDate(o.date) })),
      { label: 'Свободно', value: money(b.free) },
    ],
    chips: ['что спишется на неделе', 'советы'],
  }
}

function upcoming(text: string, ctx: Ctx): Reply {
  const days = /месяц/.test(norm(text)) ? 30 : 7
  const until = addDays(ctx.today, days)
  const balances = accountBalances(ctx.accounts, ctx.transactions)
  const items: { date: string; label: string; value: string }[] = []
  for (const s of ctx.subscriptions) {
    if (s.nextDate <= until) {
      items.push({ date: s.nextDate, label: s.name, value: `${s.direction === 'income' ? '+' : '−'}${formatAmount(s.amount, s.currency)}` })
    }
  }
  for (const a of ctx.accounts) {
    const balance = balances.get(a.id) ?? 0
    if (balance >= 0) continue
    if (a.nextPaymentDate && a.nextPaymentDate <= until) {
      items.push({ date: a.nextPaymentDate, label: `${accountLabel(a)}: взнос`, value: a.paymentAmount ? `−${formatAmount(a.paymentAmount, a.currency)}` : '' })
    }
    const grace = graceToPay(a, balance)
    if (grace > 0 && a.graceDate! <= until) items.push({ date: a.graceDate!, label: `${accountLabel(a)}: конец льготного периода`, value: `−${formatAmount(grace, a.currency)}` })
  }
  items.sort((a, b) => a.date.localeCompare(b.date))
  const period = days === 7 ? 'в ближайшую неделю' : 'в ближайший месяц'
  if (items.length === 0) return { text: [`${period[0].toUpperCase()}${period.slice(1)} платежей нет.`], chips: days === 7 ? ['что спишется за месяц'] : [] }
  return {
    text: [`${period[0].toUpperCase()}${period.slice(1)}:`],
    rows: items.map((i) => {
      const left = daysUntil(i.date, ctx.today)
      return { label: i.label, value: i.value, hint: left < 0 ? `просрочено, ${formatDate(i.date)}` : left === 0 ? 'сегодня' : left === 1 ? 'завтра' : formatDate(i.date) }
    }),
    chips: days === 7 ? ['что спишется за месяц', 'сколько можно тратить в день'] : ['сколько можно тратить в день'],
  }
}

function debts(text: string, ctx: Ctx): Reply {
  const balances = accountBalances(ctx.accounts, ctx.transactions)
  const list = words(text)
  const named = mentionedAccounts(list, ctx.accounts).map((m) => m.account).filter((a) => isDebtKind(a.kind))
  const targets = (named.length > 0 ? named : ctx.accounts.filter((a) => isDebtKind(a.kind))).filter((a) => (balances.get(a.id) ?? 0) < 0)
  if (targets.length === 0) return { text: ['Долгов нет — закрывать нечего.'] }
  const extra = /больше|сверху|дополнительно|если/.test(norm(text)) ? (parseMoney(text) ?? 0) : 0
  const lines: string[] = []
  const rows: NonNullable<Reply['rows']> = []
  for (const a of targets) {
    const debt = -(balances.get(a.id) ?? 0)
    const money = (m: number) => formatAmount(m, a.currency)
    if (!a.paymentAmount) {
      lines.push(`${accountLabel(a)}: долг ${money(debt)}. Укажи размер ежемесячного взноса в настройках счёта — тогда посчитаю срок.`)
      continue
    }
    const base = payoff(debt, a.interestRate ?? 0, a.paymentAmount)
    const start = a.nextPaymentDate ?? ctx.today
    const when = (months: number) => {
      const m = shiftMonth(start.slice(0, 7), months - 1)
      return `${MONTHS[Number(m.slice(5)) - 1][1]} ${m.slice(0, 4)}`
    }
    if (base.months === null) {
      lines.push(`${accountLabel(a)}: взнос ${money(a.paymentAmount)} не покрывает даже проценты — долг не уменьшается.`)
      continue
    }
    lines.push(
      `${accountLabel(a)}: долг ${money(debt)}${a.interestRate ? ` под ${formatRate(a.interestRate)}` : ''}. При взносе ${money(a.paymentAmount)} закроешь за ${base.months} мес. — к концу: ${when(base.months)}${base.interest > 0 ? `, на проценты уйдёт ${money(base.interest)}` : ''}.`,
    )
    if (extra > 0) {
      const faster = payoff(debt, a.interestRate ?? 0, a.paymentAmount + extra)
      if (faster.months !== null) {
        rows.push({
          label: `${accountLabel(a)}: +${money(extra)} в месяц`,
          value: `${faster.months} мес.`,
          hint: `быстрее на ${base.months - faster.months} мес., экономия ${money(base.interest - faster.interest)}`,
        })
      }
    }
  }
  return { text: lines, rows, chips: extra > 0 ? ['сколько можно тратить в день'] : ['что если вносить на 5000 больше'] }
}

function balance(text: string, ctx: Ctx): Reply {
  const balances = accountBalances(ctx.accounts, ctx.transactions)
  const named = mentionedAccounts(words(text), ctx.accounts).map((m) => m.account)
  const list = named.length > 0 ? named : ctx.accounts
  return {
    text: [named.length > 0 ? 'Остаток:' : 'Остатки на счетах:'],
    rows: list.map((a) => ({ label: accountLabel(a), value: formatAmount(balances.get(a.id) ?? 0, a.currency) })),
    chips: ['сколько можно тратить в день'],
  }
}

function advice(ctx: Ctx): Reply {
  const balances = accountBalances(ctx.accounts, ctx.transactions)
  const list = tips(ctx.accounts, ctx.categories, ctx.transactions, ctx.subscriptions, balances, ctx.today)
  if (list.length === 0) return { text: ['Всё спокойно: лимиты в норме, необычных трат нет, на обязательные платежи хватает.'], chips: ['сколько можно тратить в день'] }
  return { text: list.map((t) => t.text), chips: ['сколько можно тратить в день', 'что спишется на неделе'] }
}

let queued: string | null = null

/** Вопрос, который помощник задаст сам, когда откроется: так другие экраны ведут к подробностям. */
export function queueQuestion(text: string): void {
  queued = text
}

export function queuedQuestion(): string | null {
  return queued
}

export function clearQueuedQuestion(): void {
  queued = null
}

const UNKNOWN: Reply = {
  text: ['Не понял. Я разбираю фразы о деньгах — например, «кофе 250» или «сколько потратил на кафе». Вот что я умею:'],
  chips: ['что ты можешь'],
}

/** Ответ помощника на сообщение. */
export function answer(input: string, ctx: Ctx): Reply {
  const text = input.trim()
  const low = norm(text)
  const list = words(text)
  if (!text) return GREETING
  if (/что (ты )?(можешь|умеешь)|помощь|команды|^help$|^\?$|^привет/.test(low)) return help(ctx)
  if (ctx.accounts.length === 0) return { text: ['Сначала добавь счёт на вкладке «Счета» — без него мне не с чем работать.'] }

  // Вопрос или запрос отчёта, а не операция: «доходы за 3 месяца» — это не доход на 3 рубля.
  const question = /\?|сколько|когда|что|как|куда|какие|покажи|сравни|если|потрат|расход|доход|трат|ушло|баланс|остат|совет|спишет|закро/.test(low)
  if (!question && parseMoney(text)) {
    const draft = parseOperation(text, ctx)
    if (draft) return { text: ['Записать так?'], draft }
  }

  if (/можно тратить|в день|на день|бюджет/.test(low)) return perDay(ctx)
  if (/закро|погаш|досрочн|если вносить|если платить/.test(low)) return debts(text, ctx)
  if (/спишет|списан|ближайш|платежи|оплатить/.test(low)) return upcoming(text, ctx)
  if (/сравни/.test(low)) return compare(ctx)
  if (/больше всего|топ|куда уход|куда уш/.test(low)) return biggest(text, ctx)
  if (/совет|как дела|что не так|подскажи/.test(low)) return advice(ctx)
  if (/баланс|сколько денег|остат|на счет|на карт/.test(low) && !hasRoot(list, 'потрат', 'расход')) return balance(text, ctx)
  if (hasRoot(list, 'заработ', 'доход', 'получил', 'пришл')) return spent(text, ctx, 'income')
  if (hasRoot(list, 'потрат', 'расход', 'трат', 'ушло', 'истрат')) return spent(text, ctx, 'expense')

  if (parseMoney(text)) {
    const draft = parseOperation(text, ctx)
    if (draft) return { text: ['Записать так?'], draft }
  }
  return UNKNOWN
}

/** Короткое описание черновика для карточки: «Расход · Кафе · Счёт Карта · вчера». */
export function describeDraft(draft: Draft, ctx: Ctx): { title: string; amount: string; details: string } {
  const account = ctx.accounts.find((a) => a.id === draft.accountId)
  const to = ctx.accounts.find((a) => a.id === draft.toAccountId)
  const category = ctx.categories.find((c) => c.id === draft.categoryId)
  const when = draft.date === ctx.today ? 'сегодня' : draft.date === addDays(ctx.today, -1) ? 'вчера' : formatDate(draft.date)
  const kind = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' }[draft.type]
  const title = draft.type === 'transfer' ? kind : `${kind} · ${category?.name ?? 'без категории'}`
  const accounts = draft.type === 'transfer' ? `${account ? accountLabel(account) : '?'} → ${to ? accountLabel(to) : '?'}` : account ? accountLabel(account) : '?'
  return {
    title,
    amount: `${draft.type === 'income' ? '+' : draft.type === 'expense' ? '−' : ''}${formatAmount(draft.amount, account?.currency ?? 'RUB')}`,
    details: [accounts, when, draft.note].filter(Boolean).join(' · '),
  }
}

