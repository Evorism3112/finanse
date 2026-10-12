// Все суммы хранятся целым числом копеек, чтобы не терять точность на дробях.

export const CURRENCIES = ['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH', 'GEL', 'TRY', 'CNY', 'GBP']

/** Разбирает ввод вида «1 234,56» в копейки. Возвращает null, если это не сумма. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[\s ]/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null
  const negative = s.startsWith('-')
  const [whole, frac = ''] = s.replace('-', '').split('.')
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor)) return null
  return negative && minor !== 0 ? -minor : minor
}

const formatters = new Map<string, Intl.NumberFormat>()

export function formatAmount(minor: number, currency: string): string {
  let f = formatters.get(currency)
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { style: 'currency', currency })
    formatters.set(currency, f)
  }
  return f.format(minor / 100)
}

/** Разбирает процентную ставку вида «16,5». Возвращает null, если это не ставка. */
export function parseRate(input: string): number | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const rate = Number(s)
  return rate <= 1000 ? rate : null
}

export function formatRate(rate: number): string {
  return `${rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`
}

/** Сумма в виде, пригодном для поля ввода: «1234,56». */
export function amountToInput(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',')
}
