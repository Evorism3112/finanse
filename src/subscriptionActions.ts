import { today } from './dates'
import { db, newRecord, touched, type Subscription, type Transaction } from './db'
import { addPeriod, nextInstallment } from './subscriptions'

/**
 * Отмечает регулярный платёж или доход выполненным: записывает операцию по счёту (если он указан)
 * и переносит дату на следующий период или на следующую выплату. Сохраняет и остальные поля записи, поэтому годится и для формы.
 */
export async function paySubscription(sub: Subscription): Promise<void> {
  await db.transaction('rw', db.subscriptions, db.transactions, async () => {
    if (sub.accountId) {
      await db.transactions.add(
        newRecord<Transaction>({
          type: sub.direction,
          amount: sub.amount,
          accountId: sub.accountId,
          toAccountId: null,
          toAmount: null,
          categoryId: sub.categoryId,
          date: today(),
          note: sub.name,
        }),
      )
    }
    // У записи из нескольких выплат следующей становится очередная выплата со своей суммой.
    const next = sub.installments?.length
      ? nextInstallment(sub.installments, sub.nextDate)
      : { date: addPeriod(sub.nextDate, sub.period), amount: sub.amount }
    await db.subscriptions.put({ ...sub, nextDate: next.date, amount: next.amount, ...touched() })
  })
}
