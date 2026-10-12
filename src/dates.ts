// Даты хранятся строками ГГГГ-ММ-ДД, месяцы — ГГГГ-ММ. Часовые пояса на них не влияют.

const pad = (n: number) => String(n).padStart(2, '0')

/** Местная дата в виде ГГГГ-ММ-ДД. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function today(): string {
  return isoDate(new Date())
}

export function currentMonth(): string {
  return today().slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const weekdayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const label = monthFormat.format(new Date(y, m - 1, 1))
  return label[0].toUpperCase() + label.slice(1)
}

const monthShortFormat = new Intl.DateTimeFormat('ru-RU', { month: 'short' })

/** Короткое название месяца для подписи на графике: «окт». */
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return monthShortFormat.format(new Date(y, m - 1, 1)).replace('.', '')
}

/** Дата для показа: ГГГГ-ММ-ДД → ДД.ММ.ГГ. Пустая строка остаётся пустой. */
export function formatDate(date: string): string {
  if (!date) return ''
  const [y, m, d] = date.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

/** Разбирает ДД.ММ.ГГ в ГГГГ-ММ-ДД. Возвращает null, если такой даты не существует. */
export function parseDate(text: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(text.trim())
  if (!match) return null
  const [d, m, y] = [Number(match[1]), Number(match[2]), 2000 + Number(match[3])]
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Дата с днём недели: «пн, 12.10.26». */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${weekdayFormat.format(new Date(y, m - 1, d))}, ${formatDate(date)}`
}
