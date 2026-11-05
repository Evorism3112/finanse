import { cardDebt } from './cards'
import { addDays } from './dates'
import type { Account, Subscription } from './db'
import { graceToPay, isGraceDue, isPaymentDue } from './payments'
import { isDue } from './subscriptions'

/** Один срок в календаре платежей. */
export type ScheduleItem =
  | { kind: 'payment' | 'grace'; id: string; date: string; amount: number | null; currency: string; account: Account; due: boolean }
  | { kind: 'subscription'; id: string; date: string; amount: number; currency: string; subscription: Subscription; due: boolean }

/**
 * Сроки на ближайшие days дней, включая просроченные: обязательные платежи по кредиткам, концы льготных периодов
 * и списания подписок. due — пора напоминать (наступил срок напоминания, заданный у записи).
 */
export function paymentSchedule(
  accounts: Account[],
  balances: Map<string, number>,
  subscriptions: Subscription[],
  today: string,
  days = 30,
): ScheduleItem[] {
  const limit = addDays(today, days)
  const items: ScheduleItem[] = []

  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0
    if (cardDebt(balance) === 0) continue
    if (account.nextPaymentDate != null && account.nextPaymentDate <= limit) {
      items.push({
        kind: 'payment',
        id: `${account.id}:pay`,
        date: account.nextPaymentDate,
        amount: account.paymentAmount,
        currency: account.currency,
        account,
        due: isPaymentDue(account, balance, today),
      })
    }
    const grace = graceToPay(account, balance)
    if (grace > 0 && account.graceDate! <= limit) {
      items.push({
        kind: 'grace',
        id: `${account.id}:grace`,
        date: account.graceDate!,
        amount: grace,
        currency: account.currency,
        account,
        due: isGraceDue(account, balance, today),
      })
    }
  }

  for (const sub of subscriptions) {
    if (sub.nextDate > limit) continue
    items.push({ kind: 'subscription', id: sub.id, date: sub.nextDate, amount: sub.amount, currency: sub.currency, subscription: sub, due: isDue(sub, today) })
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

/**
 * Сколько нужно заплатить по этим срокам, по валютам: обязательные платежи и подписки.
 * Льготный период не прибавляется — это тот же долг, что и обязательный платёж, только с другим сроком.
 */
export function scheduleTotals(items: ScheduleItem[]): [string, number][] {
  const totals = new Map<string, number>()
  for (const item of items) {
    if (item.kind === 'grace' || item.amount === null) continue
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.amount)
  }
  return [...totals]
}
