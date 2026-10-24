// Подготовка операций из выписки: поиск тех, что уже записаны, и подбор категорий.
import { addDays } from './dates'
import type { Category, Transaction } from './db'
import type { StatementRow } from './statement'

export interface ImportItem {
  key: number
  row: StatementRow
  type: 'income' | 'expense'
  /** Сумма в копейках, положительная. */
  amount: number
  /** Уже записанная операция, которая, похоже, и есть эта строка выписки. */
  duplicateOf: string | null
  categoryId: string | null
}

/** На сколько дней может расходиться дата: банк проводит покупку на день-два позже, чем её записали. */
const DATE_TOLERANCE = 2

/** Ключ магазина для запоминания категории: без цифр, знаков и регистра. */
export function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 3)
    .join(' ')
}

/**
 * Правила для первой встречи с магазином: категория банка, MCC или слова в описании → слова в названии своей категории.
 * Стандартные категории приложения под них подходят, а свои пользователь может назвать как угодно — тогда просто не найдём.
 */
const RULES: { kind: Category['kind']; match: RegExp; mcc?: RegExp; target: RegExp }[] = [
  { kind: 'expense', match: /супермаркет|продукт|гипермаркет/i, mcc: /^54(11|22|41|51|62|99)$/, target: /продукт|еда/i },
  { kind: 'expense', match: /ресторан|кафе|фастфуд|фаст-фуд|кофе/i, mcc: /^58(12|13|14)$/, target: /кафе|ресторан/i },
  { kind: 'expense', match: /транспорт|такси|метро|топливо|азс|каршеринг|парковк/i, mcc: /^(41(11|21|31)|55(41|42)|7523)$/, target: /транспорт|авто/i },
  { kind: 'expense', match: /аптек|медицин|здоров|клиник|стоматолог/i, mcc: /^(5912|80(11|21|31|42|43|62|99))$/, target: /здоров|медицин|аптек/i },
  { kind: 'expense', match: /жкх|коммунал|квартплат|аренд/i, mcc: /^4900$/, target: /жиль|жкх|коммунал|квартир/i },
  { kind: 'expense', match: /развлечен|кино|театр|концерт/i, mcc: /^(7832|7922|7991|7996)$/, target: /развлеч|досуг/i },
  { kind: 'expense', match: /цифров|подписк|музык|онлайн-кинотеатр/i, mcc: /^581[5-8]$/, target: /подписк/i },
  { kind: 'expense', match: /связь|мобильн|интернет/i, mcc: /^48(14|99)$/, target: /связь|телефон|интернет|подписк/i },
  { kind: 'expense', match: /процент.*кредит|погашение процентов/i, target: /процент/i },
  { kind: 'income', match: /зарплат|заработн/i, target: /зарплат/i },
]

function ruleCategory(row: StatementRow, kind: Category['kind'], categories: Category[]): string | null {
  const text = `${row.bankCategory} ${row.description}`
  for (const rule of RULES) {
    if (rule.kind !== kind) continue
    if (!rule.match.test(text) && !(rule.mcc && row.mcc && rule.mcc.test(row.mcc))) continue
    const found = categories.find((c) => c.kind === kind && rule.target.test(c.name))
    if (found) return found.id
  }
  return null
}

/** Запомненные категории магазинов: по последней операции с таким же описанием. */
export function learnedCategories(transactions: Transaction[], categories: Category[]): Map<string, string> {
  const alive = new Set(categories.map((c) => c.id))
  const learned = new Map<string, { id: string; at: number }>()
  for (const t of transactions) {
    if (t.type === 'transfer' || !t.categoryId || !alive.has(t.categoryId) || !t.note) continue
    const key = `${t.type}:${merchantKey(t.note)}`
    const prev = learned.get(key)
    if (!prev || t.updatedAt > prev.at) learned.set(key, { id: t.categoryId, at: t.updatedAt })
  }
  return new Map([...learned].map(([k, v]) => [k, v.id]))
}

/** Сумма уже записанной операции так, как её видит выписка этого счёта: списание со знаком минус. */
function signedOnAccount(t: Transaction, accountId: string): number | null {
  if (t.accountId === accountId) return t.type === 'income' ? t.amount : -t.amount
  if (t.type === 'transfer' && t.toAccountId === accountId) return t.toAmount ?? t.amount
  return null
}

/**
 * Превращает строки выписки в операции для счёта. Строка считается уже записанной, если на этом счёте
 * есть операция с той же суммой и датой в пределах пары дней; каждая записанная операция закрывает одну строку,
 * поэтому две одинаковые покупки за день не схлопнутся в одну.
 */
export function prepareImport(rows: StatementRow[], accountId: string, transactions: Transaction[], categories: Category[]): ImportItem[] {
  const learned = learnedCategories(transactions, categories)
  const existing = transactions
    .map((t) => ({ t, signed: signedOnAccount(t, accountId) }))
    .filter((e): e is { t: Transaction; signed: number } => e.signed !== null)
  const used = new Set<string>()

  return rows.map((row, key) => {
    const type = row.amount > 0 ? 'income' : 'expense'
    const from = addDays(row.date, -DATE_TOLERANCE)
    const to = addDays(row.date, DATE_TOLERANCE)
    const distance = (d: string) => Math.abs(new Date(d).getTime() - new Date(row.date).getTime())
    const match = existing
      .filter((e) => !used.has(e.t.id) && e.signed === row.amount && e.t.date >= from && e.t.date <= to)
      .sort((a, b) => distance(a.t.date) - distance(b.t.date))[0]
    if (match) used.add(match.t.id)

    return {
      key,
      row,
      type,
      amount: Math.abs(row.amount),
      duplicateOf: match?.t.id ?? null,
      categoryId: learned.get(`${type}:${merchantKey(row.description)}`) ?? ruleCategory(row, type, categories),
    }
  })
}
