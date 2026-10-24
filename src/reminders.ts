import { accountLabel } from './accountKinds'
import { addDays } from './dates'
import type { Account, Subscription } from './db'
import { formatAmount } from './money'
import { graceDueText, graceToPay, nextStatementDate, paymentDueText } from './payments'
import { reminderText } from './subscriptions'

/** Напоминание на будущую дату: телефон покажет его сам, даже если приложение закрыто. */
export interface UpcomingReminder {
  /** Уникален для пары «запись — повод»: при пересчёте новое напоминание заменяет старое. */
  id: string
  /** День показа, ГГГГ-ММ-ДД. */
  date: string
  title: string
  body: string
}

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

/**
 * Все напоминания, которые наступят после today в пределах horizonDays.
 * По каждому сроку их два: в день, когда пора начинать напоминать, и в сам день срока.
 * То, что уже наступило, сюда не входит — об этом приложение напоминает при открытии.
 */
export function upcomingReminders(
  subscriptions: Subscription[],
  accounts: Account[],
  balances: Map<string, number>,
  today: string,
  horizonDays = 60,
): UpcomingReminder[] {
  const limit = addDays(today, horizonDays)
  const out: UpcomingReminder[] = []
  const add = (id: string, due: string, remindDays: number, title: string, body: (day: string) => string) => {
    const days = new Set([addDays(due, -remindDays), due])
    for (const day of days) {
      if (day > today && day <= limit) out.push({ id: `${id}@${day}`, date: day, title, body: body(day) })
    }
  }

  for (const sub of subscriptions) {
    add(sub.id, sub.nextDate, sub.remindDays, sub.name, (day) => reminderText(sub, day).body)
  }

  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0
    if (balance >= 0) continue
    const money = (minor: number) => formatAmount(minor, account.currency)
    if (account.nextPaymentDate != null) {
      const amount = account.paymentAmount ? ` · ${money(account.paymentAmount)}` : ''
      add(`${account.id}:pay`, account.nextPaymentDate, account.paymentRemindDays, accountLabel(account), (day) =>
        capitalize(paymentDueText(account.nextPaymentDate!, day)) + amount,
      )
    }
    // В день выписки — напоминание узнать новый обязательный платёж, если срок следующего ещё не указан.
    if (account.kind === 'credit_card' && account.statementDay != null && account.nextPaymentDate == null) {
      const day = nextStatementDate(account.statementDay, addDays(today, 1))
      if (day <= limit) {
        out.push({ id: `${account.id}:statement@${day}`, date: day, title: accountLabel(account), body: 'Банк рассчитал обязательный платёж — посмотрите его в приложении банка и укажите' })
      }
    }
    const grace = graceToPay(account, balance)
    if (grace > 0) {
      add(`${account.id}:grace`, account.graceDate!, account.graceRemindDays, accountLabel(account), (day) =>
        `${capitalize(graceDueText(account.graceDate!, day))} · погасить ${money(grace)}`,
      )
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date))
}
