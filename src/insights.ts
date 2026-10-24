// Расчёты для подсказок: сколько можно тратить в день, прогноз месяца, погашение долгов, необычные траты.
// Чистые функции без базы: их используют главная и помощник.
import { accountLabel } from './accountKinds'
import { addDays, shiftMonth } from './dates'
import type { Account, Category, Subscription, Transaction } from './db'
import { formatAmount } from './money'
import { graceToPay } from './payments'
import { budgetRows, mainCurrency } from './stats'
import { daysUntil } from './subscriptions'

export interface Obligation {
  title: string
  date: string
  amount: number
}

export interface DailyBudget {
  currency: string
  /** Деньги на обычных счетах в основной валюте. */
  available: number
  /** Обязательные платежи до следующего дохода. */
  obligations: Obligation[]
  /** До какой даты считаем (не включая её): ближайший доход или начало следующего месяца. */
  until: string
  /** true — until взят из регулярного дохода, false — это просто конец месяца. */
  payday: boolean
  days: number
  /** Сколько остаётся после обязательных платежей. Может быть отрицательным. */
  free: number
  perDay: number
}

const lastOfMonth = (day: string) => addDays(`${shiftMonth(day.slice(0, 7), 1)}-01`, -1)

/**
 * Сколько можно тратить в день до следующего дохода, не трогая денег на обязательные платежи:
 * регулярные расходы, взносы по кредитам и погашение для льготного периода.
 * Считаются только обычные счета: сбережения и кредитный лимит — не деньги на каждый день.
 */
export function dailyBudget(
  accounts: Account[],
  balances: Map<string, number>,
  subscriptions: Subscription[],
  today: string,
): DailyBudget {
  const currency = mainCurrency(accounts)
  const available = accounts
    .filter((a) => a.kind === 'regular' && a.currency === currency)
    .reduce((sum, a) => sum + Math.max(0, balances.get(a.id) ?? 0), 0)

  const incomes = subscriptions
    .filter((s) => s.direction === 'income' && s.currency === currency && s.nextDate > today)
    .map((s) => s.nextDate)
    .sort()
  const payday = incomes.length > 0
  const until = payday ? incomes[0] : addDays(lastOfMonth(today), 1)

  const obligations: Obligation[] = []
  for (const s of subscriptions) {
    if (s.direction === 'expense' && s.currency === currency && s.nextDate < until) {
      obligations.push({ title: s.name, date: s.nextDate, amount: s.amount })
    }
  }
  for (const a of accounts) {
    const balance = balances.get(a.id) ?? 0
    if (a.currency !== currency || balance >= 0) continue
    const grace = graceToPay(a, balance)
    if (grace > 0 && a.graceDate! < until) {
      obligations.push({ title: `${accountLabel(a)}: льготный период`, date: a.graceDate!, amount: grace })
    } else if (a.paymentAmount && a.nextPaymentDate != null && a.nextPaymentDate < until) {
      obligations.push({ title: `${accountLabel(a)}: взнос`, date: a.nextPaymentDate, amount: Math.min(a.paymentAmount, -balance) })
    }
  }
  obligations.sort((a, b) => a.date.localeCompare(b.date))

  const days = Math.max(1, daysUntil(until, today))
  const free = available - obligations.reduce((sum, o) => sum + o.amount, 0)
  return { currency, available, obligations, until, payday, days, free, perDay: Math.floor(Math.max(0, free) / days) }
}

/** Расходы в основной валюте за даты from..to включительно, по категориям. */
export function expensesBetween(
  accounts: Account[],
  transactions: Transaction[],
  from: string,
  to: string,
  type: 'expense' | 'income' = 'expense',
): { total: number; count: number; byCategory: Map<string | null, number> } {
  const currency = mainCurrency(accounts)
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]))
  const byCategory = new Map<string | null, number>()
  let total = 0
  let count = 0
  for (const t of transactions) {
    if (t.type !== type || t.date < from || t.date > to || currencyOf.get(t.accountId) !== currency) continue
    total += t.amount
    count++
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + t.amount)
  }
  return { total, count, byCategory }
}

export interface MonthForecast {
  spent: number
  /** Ожидаемые расходы за весь месяц при нынешнем темпе. */
  forecast: number
  /** Средние расходы за три прошлых месяца; null — истории нет. */
  usual: number | null
}

/**
 * Прогноз расходов месяца: потраченное плюс средний дневной темп на оставшиеся дни.
 * В первые дни темп ненадёжен, поэтому до 5-го числа прогноз не строится.
 */
export function monthForecast(accounts: Account[], transactions: Transaction[], today: string): MonthForecast | null {
  const dayOfMonth = Number(today.slice(8))
  if (dayOfMonth < 5) return null
  const month = today.slice(0, 7)
  const spent = expensesBetween(accounts, transactions, `${month}-01`, today).total
  const daysInMonth = Number(lastOfMonth(today).slice(8))
  const forecast = Math.round((spent / dayOfMonth) * daysInMonth)
  const past = [1, 2, 3].map((i) => {
    const m = shiftMonth(month, -i)
    return expensesBetween(accounts, transactions, `${m}-01`, lastOfMonth(`${m}-01`)).total
  })
  const withData = past.filter((v) => v > 0)
  const usual = withData.length > 0 ? Math.round(withData.reduce((s, v) => s + v, 0) / withData.length) : null
  return { spent, forecast, usual }
}

export interface Payoff {
  /** Месяцев до полного погашения; null — взнос не покрывает даже проценты. */
  months: number | null
  /** Сколько уйдёт на проценты за это время, в копейках. */
  interest: number
}

/** Помесячное погашение долга фиксированным взносом с процентами по годовой ставке. */
export function payoff(debt: number, ratePercent: number, payment: number): Payoff {
  let left = debt
  let interest = 0
  for (let month = 1; month <= 600; month++) {
    const charged = Math.round((left * ratePercent) / 1200)
    if (payment <= charged) return { months: null, interest: 0 }
    interest += charged
    left += charged - payment
    if (left <= 0) return { months: month, interest }
  }
  return { months: null, interest: 0 }
}

export interface Unusual {
  categoryId: string | null
  spent: number
  usual: number
}

/**
 * Категории, где в этом месяце потрачено заметно больше обычного: в полтора раза больше среднего
 * за три прошлых месяца и минимум на 1 000 в основной валюте.
 */
export function unusualSpending(accounts: Account[], transactions: Transaction[], today: string): Unusual[] {
  const month = today.slice(0, 7)
  const now = expensesBetween(accounts, transactions, `${month}-01`, today).byCategory
  const past = [1, 2, 3].map((i) => {
    const m = shiftMonth(month, -i)
    return expensesBetween(accounts, transactions, `${m}-01`, lastOfMonth(`${m}-01`)).byCategory
  })
  const out: Unusual[] = []
  for (const [categoryId, spent] of now) {
    const history = past.map((p) => p.get(categoryId) ?? 0).filter((v) => v > 0)
    if (history.length < 2) continue
    const usual = Math.round(history.reduce((s, v) => s + v, 0) / history.length)
    if (spent > usual * 1.5 && spent - usual >= 100_000) out.push({ categoryId, spent, usual })
  }
  return out.sort((a, b) => b.spent - b.usual - (a.spent - a.usual))
}

export interface Recurring {
  note: string
  amount: number
  categoryId: string | null
  accountId: string
}

/**
 * Похожие на подписку списания: одна и та же сумма с тем же комментарием в каждом из трёх последних месяцев,
 * которых ещё нет среди регулярных платежей.
 */
export function recurringCandidates(transactions: Transaction[], subscriptions: Subscription[], today: string): Recurring[] {
  const months = [0, 1, 2].map((i) => shiftMonth(today.slice(0, 7), -i))
  const known = new Set(subscriptions.map((s) => s.name.trim().toLowerCase()))
  const groups = new Map<string, { months: Set<string>; tx: Transaction }>()
  for (const t of transactions) {
    const note = t.note.trim().toLowerCase()
    if (t.type !== 'expense' || !note || !months.includes(t.date.slice(0, 7))) continue
    const key = `${note}|${t.amount}`
    const group = groups.get(key) ?? { months: new Set<string>(), tx: t }
    group.months.add(t.date.slice(0, 7))
    groups.set(key, group)
  }
  return [...groups.values()]
    .filter((g) => g.months.size >= 3 && !known.has(g.tx.note.trim().toLowerCase()))
    .map(({ tx }) => ({ note: tx.note.trim(), amount: tx.amount, categoryId: tx.categoryId, accountId: tx.accountId }))
}

export interface Tip {
  /** warn — стоит обратить внимание, info — просто к сведению. */
  level: 'warn' | 'info'
  text: string
}

/** Короткие советы для главной и помощника: лимиты, необычные траты, похожие на подписку списания, прогноз. */
export function tips(
  accounts: Account[],
  categories: Category[],
  transactions: Transaction[],
  subscriptions: Subscription[],
  balances: Map<string, number>,
  today: string,
): Tip[] {
  const currency = mainCurrency(accounts)
  const money = (minor: number) => formatAmount(minor, currency)
  const nameOf = (id: string | null) => (id && categories.find((c) => c.id === id)?.name) || 'Без категории'
  const month = today.slice(0, 7)
  const out: Tip[] = []

  const budget = dailyBudget(accounts, balances, subscriptions, today)
  if (budget.free < 0) {
    out.push({ level: 'warn', text: `До ${budget.payday ? 'следующего дохода' : 'конца месяца'} не хватает ${money(-budget.free)} на обязательные платежи.` })
  }

  const daysLeft = daysUntil(lastOfMonth(today), today) + 1
  const spentByCategory = expensesBetween(accounts, transactions, `${month}-01`, today).byCategory
  for (const row of budgetRows(categories, [...spentByCategory].map(([categoryId, amount]) => ({ categoryId, amount })))) {
    const ratio = row.spent / row.budget
    if (ratio >= 1) out.push({ level: 'warn', text: `Лимит на «${nameOf(row.categoryId)}» превышен на ${money(row.spent - row.budget)}.` })
    else if (ratio >= 0.8) {
      out.push({ level: 'warn', text: `«${nameOf(row.categoryId)}»: потрачено ${Math.round(ratio * 100)}% лимита, до конца месяца ${daysLeft} дн. Осталось ${money(row.budget - row.spent)}.` })
    }
  }

  for (const u of unusualSpending(accounts, transactions, today).slice(0, 2)) {
    out.push({ level: 'info', text: `На «${nameOf(u.categoryId)}» в этом месяце уже ${money(u.spent)}, обычно за месяц около ${money(u.usual)}.` })
  }

  const forecast = monthForecast(accounts, transactions, today)
  if (forecast?.usual && forecast.forecast > forecast.usual * 1.15) {
    const percent = Math.round((forecast.forecast / forecast.usual - 1) * 100)
    out.push({ level: 'info', text: `При таком темпе расходы за месяц составят около ${money(forecast.forecast)} — на ${percent}% больше обычного.` })
  }

  for (const r of recurringCandidates(transactions, subscriptions, today).slice(0, 2)) {
    out.push({ level: 'info', text: `«${r.note}» по ${formatAmount(r.amount, currency)} списывается каждый месяц — похоже на подписку. Её можно добавить в «Регулярные», чтобы приложение напоминало о сроке.` })
  }
  return out
}
