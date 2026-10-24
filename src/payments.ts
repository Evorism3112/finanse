import { accountLabel } from './accountKinds'
import { addDays, formatDate, shiftMonth } from './dates'
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

/** Сколько дней после выписки напоминать, что пора узнать в банке рассчитанный обязательный платёж. */
const STATEMENT_REMIND_DAYS = 10

/** Дата с этим числом в месяце month (ГГГГ-ММ); числа, которого в месяце нет, прижимаются к его концу. */
function dayOfMonth(month: string, day: number): string {
  const last = Number(addDays(`${shiftMonth(month, 1)}-01`, -1).slice(8))
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`
}

/** Ближайшая дата выписки не раньше today. */
export function nextStatementDate(day: number, today: string): string {
  const thisMonth = dayOfMonth(today.slice(0, 7), day)
  return thisMonth >= today ? thisMonth : dayOfMonth(shiftMonth(today.slice(0, 7), 1), day)
}

/** Последняя дата выписки не позже today. */
export function lastStatementDate(day: number, today: string): string {
  const thisMonth = dayOfMonth(today.slice(0, 7), day)
  return thisMonth <= today ? thisMonth : dayOfMonth(shiftMonth(today.slice(0, 7), -1), day)
}

/**
 * Что известно об обязательном платеже кредитки, у которой задан день выписки, а срок платежа ещё не указан:
 * waiting — банк рассчитает его в день выписки, calculated — выписка недавно была, пора узнать сумму в банке.
 * null — есть указанный платёж, нет долга или день выписки не задан.
 */
export function statementState(
  account: Account,
  balance: number,
  today: string,
): { kind: 'waiting' | 'calculated'; date: string } | null {
  if (account.kind !== 'credit_card' || account.statementDay == null || balance >= 0 || account.nextPaymentDate != null) return null
  const last = lastStatementDate(account.statementDay, today)
  if (daysUntil(today, last) <= STATEMENT_REMIND_DAYS) return { kind: 'calculated', date: last }
  return { kind: 'waiting', date: nextStatementDate(account.statementDay, today) }
}

/** Строка о выписке: «обязательный платёж рассчитают 05.11» или «обязательный платёж рассчитан 05.11 — укажите его». */
export function statementText(state: { kind: 'waiting' | 'calculated'; date: string }, today: string): string {
  if (state.kind === 'calculated') {
    return `обязательный платёж рассчитан ${state.date === today ? 'сегодня' : formatDate(state.date)} — посмотрите его в банке и укажите`
  }
  const days = daysUntil(state.date, today)
  return `обязательный платёж рассчитают ${days === 1 ? 'завтра' : formatDate(state.date)}`
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
  const statement = statementState(account, balance, today)
  if (statement?.kind === 'calculated') {
    const text = statementText(statement, today)
    reminders.push({ id: `${account.id}:statement`, title: accountLabel(account), text, body: capitalize(text) })
  }
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
