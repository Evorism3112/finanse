import { db, deleted, newRecord, touched, type Account, type Transaction } from './db'
import { creditUsage } from './stats'

/** Цвет значка кредиток. */
export const CARD_COLOR = '#FFB35C'

/**
 * Долг кредитки хранится как раньше: начальный остаток плюс операции по карте (взносы, оплаты подписок,
 * записи прежних версий). Покупки по отдельности не ведутся — долг просто сверяют с приложением банка.
 */

/** Долг карты положительным числом; свои деньги на карте долгом не считаются. */
export function cardDebt(balance: number): number {
  return Math.max(0, 0 - balance)
}

export interface CardTotal {
  currency: string
  /** Общий долг. */
  debt: number
  /** Сумма лимитов карт, у которых он указан. */
  limit: number
  /** Сколько ещё можно потратить по этим картам. */
  available: number
}

/** Долг, лимит и доступный остаток по каждой валюте. */
export function cardTotals(accounts: Account[], balances: Map<string, number>): CardTotal[] {
  const byCurrency = new Map<string, CardTotal>()
  for (const a of accounts) {
    const balance = balances.get(a.id) ?? 0
    let entry = byCurrency.get(a.currency)
    if (!entry) {
      entry = { currency: a.currency, debt: 0, limit: 0, available: 0 }
      byCurrency.set(a.currency, entry)
    }
    entry.debt += cardDebt(balance)
    if (a.creditLimit) {
      entry.limit += a.creditLimit
      entry.available += creditUsage(a.creditLimit, balance, a.interestDebt).available
    }
  }
  return [...byCurrency.values()]
}

/**
 * Начальный остаток, при котором текущий долг станет равен debt.
 * История операций не трогается: поправка уходит в начальный остаток.
 */
export function initialBalanceForDebt(account: Pick<Account, 'initialBalance'>, balance: number, debt: number): number {
  return account.initialBalance + (0 - debt - balance)
}

/** Указывает текущий долг по карте — например, как его показывает приложение банка. */
export async function setCardDebt(account: Account, balance: number, debt: number): Promise<void> {
  await db.accounts.update(account.id, { initialBalance: initialBalanceForDebt(account, balance, debt), ...touched() })
}

/** Записывает взнос на карту: долг уменьшается на сумму взноса. */
export function paymentRecord(account: Account, amount: number, date: string, note: string): Transaction {
  return newRecord<Transaction>({
    type: 'income',
    accountId: account.id,
    amount,
    toAccountId: null,
    toAmount: null,
    categoryId: null,
    date,
    note,
  })
}

/** Удаляет карту вместе с её взносами и операциями. */
export async function deleteCard(account: Account): Promise<void> {
  await db.transaction('rw', db.accounts, db.transactions, db.subscriptions, async () => {
    const mark = deleted()
    await db.transactions
      .filter((t) => t.deletedAt === null && (t.accountId === account.id || t.toAccountId === account.id))
      .modify(mark)
    // Подписки, которые списывались с этой карты, остаются, но больше к ней не привязаны.
    await db.subscriptions.filter((s) => s.accountId === account.id).modify({ accountId: null, ...touched() })
    await db.accounts.update(account.id, mark)
  })
}
