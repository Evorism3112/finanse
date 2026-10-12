import { accountLabel } from './accountKinds'
import { formatDate } from './dates'
import type { Account } from './db'
import { formatAmount } from './money'
import { daysUntil } from './subscriptions'

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

/** Пора ли напоминать о взносе по кредиту или кредитной карте. Без долга напоминать не о чем. */
export function isPaymentDue(account: Account, balance: number, today: string): boolean {
  return (
    balance < 0 &&
    account.nextPaymentDate != null &&
    daysUntil(account.nextPaymentDate, today) <= account.paymentRemindDays
  )
}

/** Текст о сроке взноса: «платёж через 3 дн.», «платёж просрочен на 2 дн.». */
export function paymentDueText(date: string, today: string): string {
  const days = daysUntil(date, today)
  if (days < 0) return `платёж просрочен на ${-days} дн.`
  if (days === 0) return 'платёж сегодня'
  if (days === 1) return 'платёж завтра'
  return `платёж через ${days} дн.`
}

/**
 * Сколько осталось погасить до конца льготного периода, чтобы не платить проценты.
 * 0 — льготного периода нет или условие уже выполнено.
 */
export function graceToPay(account: Account, balance: number): number {
  if (account.kind !== 'credit_card' || account.graceDate == null) return 0
  const debt = Math.max(0, 0 - balance)
  return Math.min(debt, account.graceAmount ?? debt)
}

/** Пора ли напоминать о конце льготного периода. */
export function isGraceDue(account: Account, balance: number, today: string): boolean {
  return graceToPay(account, balance) > 0 && daysUntil(account.graceDate!, today) <= account.graceRemindDays
}

/** Текст о льготном периоде: «льготный период заканчивается через 5 дн.», «льготный период истёк 2 дн. назад». */
export function graceDueText(date: string, today: string): string {
  const days = daysUntil(date, today)
  if (days < 0) return `льготный период истёк ${-days} дн. назад`
  if (days === 0) return 'льготный период заканчивается сегодня'
  if (days === 1) return 'льготный период заканчивается завтра'
  return `льготный период заканчивается через ${days} дн.`
}

/** Строка под названием карты: «без % до 25.11.26 · через 44 дн. · погасить 10 000,00 ₽». */
export function graceRowText(account: Account, balance: number, today: string): string {
  const days = daysUntil(account.graceDate!, today)
  const when = days < 0 ? `истёк ${-days} дн. назад` : days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} дн.`
  const amount = formatAmount(graceToPay(account, balance), account.currency)
  return days < 0
    ? `льготный период ${when} · ${formatDate(account.graceDate!)} · не погашено ${amount}`
    : `без % до ${formatDate(account.graceDate!)} · ${when} · погасить ${amount}`
}

export interface AccountReminder {
  /** Уникален для пары «счёт — вид напоминания»: по нему уведомление показывается не чаще раза в день. */
  id: string
  title: string
  /** Короткий текст для плашки в приложении. */
  text: string
  /** Текст системного уведомления, с суммой. */
  body: string
}

export function paymentReminder(account: Account, today: string): AccountReminder {
  const text = paymentDueText(account.nextPaymentDate!, today)
  const amount = account.paymentAmount ? ` · ${formatAmount(account.paymentAmount, account.currency)}` : ''
  return { id: account.id, title: accountLabel(account), text, body: `${capitalize(text)}${amount}` }
}

/** Все напоминания по счёту на сегодня: взнос и конец льготного периода. */
export function accountReminders(account: Account, balance: number, today: string): AccountReminder[] {
  const reminders: AccountReminder[] = []
  if (isPaymentDue(account, balance, today)) reminders.push(paymentReminder(account, today))
  if (isGraceDue(account, balance, today)) {
    const text = graceDueText(account.graceDate!, today)
    reminders.push({
      id: `${account.id}:grace`,
      title: accountLabel(account),
      text,
      body: `${capitalize(text)} · погасить ${formatAmount(graceToPay(account, balance), account.currency)}`,
    })
  }
  return reminders
}
