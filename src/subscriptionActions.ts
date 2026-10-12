import { db, newRecord, touched, type Subscription, type Transaction } from './db'
import { advanceSubscription } from './subscriptions'

/** Как на самом деле прошёл платёж или поступление: сумма и дата могут отличаться от плановых. */
export interface ActualPayment {
  amount: number
  date: string
  /** Счёт, по которому записать операцию; null — только перенести срок. */
  accountId: string | null
  /** Сделать фактическую сумму новой плановой. */
  remember: boolean
}

/**
 * Отмечает регулярный платёж или доход выполненным: записывает операцию на фактическую сумму
 * и переносит срок на следующий период или следующую выплату.
 */
export async function paySubscription(sub: Subscription, actual: ActualPayment): Promise<void> {
  await db.transaction('rw', db.subscriptions, db.transactions, async () => {
    if (actual.accountId) {
      await db.transactions.add(
        newRecord<Transaction>({
          type: sub.direction,
          amount: actual.amount,
          accountId: actual.accountId,
          toAccountId: null,
          toAmount: null,
          categoryId: sub.categoryId,
          date: actual.date,
          note: sub.name,
        }),
      )
    }
    await db.subscriptions.put({ ...sub, ...advanceSubscription(sub, actual.amount, actual.remember), ...touched() })
  })
}
