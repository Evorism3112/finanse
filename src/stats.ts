import type { Account, Category, Transaction } from './db'

/** Текущий остаток каждого счёта: начальный остаток плюс все операции. */
export function accountBalances(accounts: Account[], transactions: Transaction[]): Map<string, number> {
  const balances = new Map(accounts.map((a) => [a.id, a.initialBalance]))
  const add = (id: string | null, delta: number) => {
    if (id !== null && balances.has(id)) balances.set(id, balances.get(id)! + delta)
  }
  for (const t of transactions) {
    if (t.type === 'income') {
      add(t.accountId, t.amount)
    } else if (t.type === 'expense') {
      add(t.accountId, -t.amount)
    } else {
      add(t.accountId, -t.amount)
      add(t.toAccountId, t.toAmount ?? t.amount)
    }
  }
  return balances
}

export interface NetWorth {
  currency: string
  /** Сумма положительных остатков. */
  assets: number
  /** Сумма долгов (отрицательных остатков), положительным числом. */
  debts: number
}

/** Свои средства и долги по каждой валюте. */
export function netWorthByCurrency(accounts: Account[], balances: Map<string, number>): NetWorth[] {
  const byCurrency = new Map<string, NetWorth>()
  for (const a of accounts) {
    let entry = byCurrency.get(a.currency)
    if (!entry) {
      entry = { currency: a.currency, assets: 0, debts: 0 }
      byCurrency.set(a.currency, entry)
    }
    const balance = balances.get(a.id) ?? 0
    if (balance >= 0) entry.assets += balance
    else entry.debts -= balance
  }
  return [...byCurrency.values()]
}

/**
 * Занятая и доступная часть лимита кредитной карты.
 * Начисленные проценты входят в долг, но лимит не занимают, поэтому доступно больше, чем «лимит минус долг».
 */
export function creditUsage(limit: number, balance: number, interestDebt: number): { used: number; available: number } {
  const debt = Math.max(0, 0 - balance)
  const used = debt - Math.min(Math.max(0, interestDebt), debt)
  // Свои деньги на карте (положительный остаток) тоже доступны.
  return { used, available: limit - used + Math.max(0, balance) }
}

/** Примерные проценты за месяц при годовой ставке: доход по вкладу или плата по кредиту. */
export function monthlyInterest(balance: number, ratePercent: number): number {
  return Math.round((Math.abs(balance) * ratePercent) / 100 / 12)
}

export interface CategoryTotal {
  categoryId: string | null
  amount: number
}

export interface CurrencyReport {
  currency: string
  income: number
  expense: number
  incomeByCategory: CategoryTotal[]
  expenseByCategory: CategoryTotal[]
}

/** Доходы и расходы за месяц (ГГГГ-ММ) по валютам. Переводы в отчёт не входят. */
export function monthReport(accounts: Account[], transactions: Transaction[], month: string): CurrencyReport[] {
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]))
  const byCurrency = new Map<string, { income: Map<string | null, number>; expense: Map<string | null, number> }>()

  for (const t of transactions) {
    if (t.type === 'transfer' || !t.date.startsWith(month)) continue
    const currency = currencyOf.get(t.accountId)
    if (currency === undefined) continue
    let entry = byCurrency.get(currency)
    if (!entry) {
      entry = { income: new Map(), expense: new Map() }
      byCurrency.set(currency, entry)
    }
    const bucket = entry[t.type]
    bucket.set(t.categoryId, (bucket.get(t.categoryId) ?? 0) + t.amount)
  }

  const toList = (m: Map<string | null, number>): CategoryTotal[] =>
    [...m].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount)
  const sum = (list: CategoryTotal[]) => list.reduce((s, c) => s + c.amount, 0)

  return [...byCurrency].map(([currency, entry]) => {
    const incomeByCategory = toList(entry.income)
    const expenseByCategory = toList(entry.expense)
    return {
      currency,
      income: sum(incomeByCategory),
      expense: sum(expenseByCategory),
      incomeByCategory,
      expenseByCategory,
    }
  })
}

/** Основная валюта — валюта первого счёта. В ней задаются лимиты категорий. */
export function mainCurrency(accounts: Account[]): string {
  return accounts[0]?.currency ?? 'RUB'
}

export interface MonthPoint {
  month: string
  income: number
  expense: number
}

/** Доходы и расходы в одной валюте по каждому из месяцев (ГГГГ-ММ). */
export function monthlySeries(accounts: Account[], transactions: Transaction[], currency: string, months: string[]): MonthPoint[] {
  return months.map((month) => {
    const report = monthReport(accounts, transactions, month).find((r) => r.currency === currency)
    return { month, income: report?.income ?? 0, expense: report?.expense ?? 0 }
  })
}

export interface BudgetRow {
  categoryId: string
  budget: number
  spent: number
}

/** Категории с лимитом и расход по ним за месяц; первыми идут самые близкие к лимиту. */
export function budgetRows(categories: Pick<Category, 'id' | 'kind' | 'budget'>[], expenseByCategory: CategoryTotal[]): BudgetRow[] {
  const spent = new Map(expenseByCategory.map((c) => [c.categoryId, c.amount]))
  return categories
    .filter((c) => c.kind === 'expense' && c.budget != null && c.budget > 0)
    .map((c) => ({ categoryId: c.id, budget: c.budget!, spent: spent.get(c.id) ?? 0 }))
    .sort((a, b) => b.spent / b.budget - a.spent / a.budget)
}
