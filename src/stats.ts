import type { Account, Transaction } from './db'

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
