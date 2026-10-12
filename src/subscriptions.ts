import type { Installment, Period, Subscription } from './db'
import { formatAmount } from './money'

export const PERIODS: { period: Period; label: string; short: string }[] = [
  { period: 'week', label: 'Каждую неделю', short: 'нед.' },
  { period: 'month', label: 'Каждый месяц', short: 'мес.' },
  { period: 'year', label: 'Каждый год', short: 'год' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const parse = (date: string) => date.split('-').map(Number) as [number, number, number]

/** Сдвигает дату на один период. В коротком месяце день прижимается к его концу: 31 января → 28 февраля. */
export function addPeriod(date: string, period: Period): string {
  const [y, m, d] = parse(date)
  if (period === 'week') {
    const next = new Date(Date.UTC(y, m - 1, d + 7))
    return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
  }
  const months = y * 12 + (m - 1) + (period === 'year' ? 12 : 1)
  const year = Math.floor(months / 12)
  const month = months % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`
}

/** Сколько дней от today до date; отрицательное число — дата уже прошла. */
export function daysUntil(date: string, today: string): number {
  const [y1, m1, d1] = parse(date)
  const [y2, m2, d2] = parse(today)
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86_400_000)
}

/** Пора ли напоминать о подписке. */
export function isDue(sub: Subscription, today: string): boolean {
  return daysUntil(sub.nextDate, today) <= sub.remindDays
}

/** Стоимость подписки в пересчёте на месяц, в копейках. */
export function monthlyCost(amount: number, period: Period): number {
  if (period === 'year') return Math.round(amount / 12)
  if (period === 'week') return Math.round((amount * 52) / 12)
  return amount
}

export function installmentsTotal(parts: Installment[]): number {
  return parts.reduce((sum, p) => sum + p.amount, 0)
}

/** Дата выплаты в заданном месяце; число, которого в месяце нет, прижимается к его концу (31 → 28 февраля). */
function installmentDate(year: number, monthIndex: number, day: number): string {
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(day, lastDay))}`
}

/** Ближайшая выплата не раньше даты from. */
export function upcomingInstallment(parts: Installment[], from: string): { date: string; amount: number } {
  const [year, month] = parse(from)
  const sorted = [...parts].sort((a, b) => a.day - b.day)
  // Смотрим текущий месяц, а если все его выплаты уже позади — следующий.
  for (const shift of [0, 1]) {
    for (const part of sorted) {
      const date = installmentDate(year, month - 1 + shift, part.day)
      if (date >= from) return { date, amount: part.amount }
    }
  }
  throw new Error('у записи нет выплат')
}

/** Выплата, следующая за той, что была в дату current. */
export function nextInstallment(parts: Installment[], current: string): { date: string; amount: number } {
  const [y, m, d] = parse(current)
  const dayAfter = new Date(Date.UTC(y, m - 1, d + 1))
  return upcomingInstallment(parts, `${dayAfter.getUTCFullYear()}-${pad(dayAfter.getUTCMonth() + 1)}-${pad(dayAfter.getUTCDate())}`)
}

/** Выплата, которая приходится на эту дату, если такая есть. */
export function installmentAt(parts: Installment[], date: string): Installment | undefined {
  const [year, month] = parse(date)
  return parts.find((p) => installmentDate(year, month - 1, p.day) === date)
}

/**
 * Что станет с записью после отметки «Оплачено» / «Получено».
 * Фактическая сумма может отличаться от плановой (премия, проценты); план меняется, только если remember.
 */
export function advanceSubscription(
  sub: Pick<Subscription, 'amount' | 'period' | 'nextDate' | 'installments'>,
  actualAmount: number,
  remember: boolean,
): Pick<Subscription, 'amount' | 'nextDate' | 'installments'> {
  if (sub.installments?.length) {
    const current = installmentAt(sub.installments, sub.nextDate)
    const installments = remember ? sub.installments.map((p) => (p === current ? { ...p, amount: actualAmount } : p)) : sub.installments
    const next = nextInstallment(installments, sub.nextDate)
    return { installments, nextDate: next.date, amount: next.amount }
  }
  return {
    installments: null,
    nextDate: addPeriod(sub.nextDate, sub.period),
    amount: remember ? actualAmount : sub.amount,
  }
}

/** Сколько уходит на подписки в месяц, по валютам. */
export function monthlyTotals(subs: Subscription[]): [string, number][] {
  const totals = new Map<string, number>()
  for (const s of subs) {
    // У записи с несколькими выплатами amount — только ближайшая из них, а в месяц приходит их сумма.
    const monthly = s.installments?.length ? installmentsTotal(s.installments) : monthlyCost(s.amount, s.period)
    totals.set(s.currency, (totals.get(s.currency) ?? 0) + monthly)
  }
  return [...totals]
}

/** Текст о сроке: «списание через 3 дн.», «заканчивается завтра», «поступление сегодня», «платёж просрочен на 2 дн.». */
export function dueText(sub: Subscription, today: string): string {
  const days = daysUntil(sub.nextDate, today)
  if (sub.direction === 'income') {
    if (days < 0) return `поступление ожидалось ${-days} дн. назад`
    if (days === 0) return 'поступление сегодня'
    if (days === 1) return 'поступление завтра'
    return `поступление через ${days} дн.`
  }
  if (days < 0) return sub.autoRenew ? `платёж просрочен на ${-days} дн.` : `закончилась ${-days} дн. назад`
  const what = sub.autoRenew ? 'списание' : 'заканчивается'
  if (days === 0) return `${what} сегодня`
  if (days === 1) return `${what} завтра`
  return `${what} через ${days} дн.`
}

export function reminderText(sub: Subscription, today: string): { title: string; body: string } {
  const text = dueText(sub, today)
  return {
    title: sub.name,
    body: `${text[0].toUpperCase()}${text.slice(1)} · ${formatAmount(sub.amount, sub.currency)}`,
  }
}
