// Разбор банковских выписок в общий вид: дата, сумма со знаком, описание и подсказки для категории.
// Таблицы (CSV, Excel) разбираются по заголовкам столбцов, поэтому подходят и незнакомые банки.
// PDF приходит сюда уже строками текста: у Сбербанка свой разбор, для остальных — общий по датам и суммам.
import { parseAmount } from './money'

export interface StatementRow {
  /** ГГГГ-ММ-ДД. */
  date: string
  /** Копейки со знаком: списание отрицательное, поступление положительное. */
  amount: number
  /** Валюта суммы, если банк её указал. */
  currency: string | null
  description: string
  /** Категория, которую дал банк, — подсказка для выбора своей. */
  bankCategory: string
  mcc: string
}

export interface Statement {
  bank: string
  rows: StatementRow[]
}

/** Текст файла: банки отдают и UTF-8, и Windows-1251 (так выгружает CSV Т-Банк). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

/** Разбирает CSV с разделителем «;», «,» или табуляцией и кавычками по правилам RFC 4180. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  const outsideQuotes = firstLine.replace(/"[^"]*"/g, '')
  const delimiter = [';', '\t', ','].reduce((best, d) => (outsideQuotes.split(d).length > outsideQuotes.split(best).length ? d : best), ';')

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean))
}

const SPACES = /[\s  ]/g
const MONEY = /[+\-−]?\s?\d{1,3}(?:[\s  ]\d{3})*(?:[.,]\d{2})(?!\d)/g

/** Сумма из выписки в копейках со знаком: «−1 240,50», «+24 000,00», «1240.50 RUR». */
export function parseMoney(text: string): number | null {
  let s = text.replace(SPACES, '').replace(/−|–/g, '-').replace(/[₽$€]|RUR|RUB|USD|EUR|руб\.?/gi, '')
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '')
  else if (/\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '')
  return parseAmount(s.replace(/^\+/, ''))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Дата из выписки: «21.10.2026», «21.10.26 14:32», «2026-10-21» или число дней Excel. */
export function parseStatementDate(text: string): string | null {
  const s = text.trim()
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?!\d)/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return validDate(y, Number(m[2]), Number(m[1]))
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))
  // В Excel дата — число дней с 30.12.1899; разумные значения — примерно 2000–2100 годы.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s))
    if (serial > 36000 && serial < 75000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
      return validDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
  }
  return null
}

function validDate(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Делает из технического описания банка читаемое: убирает маски карт, служебные хвосты,
 * а из строк вида «…\RUS\MOSCOW\PYATEROCHKA 1234» и «место совершения: RU/MOSCOW/PYATEROCHKA» берёт сам магазин.
 */
export function cleanDescription(text: string): { description: string; mcc: string } {
  let s = text.replace(SPACES, ' ')
  const mcc = /MCC:?\s?(\d{4})/i.exec(s)?.[1] ?? ''
  const place = /место совершения:\s*([^,]+)/i.exec(s)
  if (place) s = place[1].split('/').pop()!
  else if (/\\[A-Z]{3}\\/.test(s)) s = s.split('\\').pop()!.split(/\s{2,}/)[0]
  s = s
    .replace(/MCC:?\s?\d{4}/gi, '')
    .replace(/Операция по (карте|сч[её]ту)\s*\*+\d+\.?/gi, '')
    .replace(/\d{4,6}[+*]{4,}\d{4}/g, '')
    .replace(/\*{2,}\d{4}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.,;:-]+|[\s,;:-]+$/g, '')
    // Точку в конце убираем после слова («Moscow RUS.»), но не после инициала («Иванов И. И.»).
    .replace(/(?<=[^\s.]{2})\.$/, '')
  return { description: s, mcc }
}

/** Слова в описании, по которым понятно, что это поступление, когда банк не ставит знак у суммы. */
const INCOME_WORDS = /зачислен|поступлен|пополнен|возврат|перевод от|входящ|зарплат|заработн|кэшбэк|cashback|проценты на остаток/i

/** Строки-итоги и остатки, которые попадают в PDF рядом с операциями. */
const SUMMARY_WORDS = /^(итого|всего|остаток|баланс|входящий|исходящий|сумма (поступлений|списаний|пополнений)|total|balance|opening|closing)/i

// --- Таблицы: CSV и Excel ------------------------------------------------------------------

interface Columns {
  date: number
  amount: number
  income: number
  expense: number
  currency: number
  description: number[]
  category: number
  mcc: number
  status: number
}

function findColumns(header: string[]): Columns | null {
  const h = header.map((c) => c.toLowerCase().replace(SPACES, ' ').trim())
  const find = (re: RegExp, except?: RegExp) => h.findIndex((c) => re.test(c) && !(except && except.test(c)))
  const notAmount = /кэшб|бонус|округл|комисс|остаток|баланс/

  const date = [find(/^дата операции/), find(/^дата( и время)?$/), find(/дата/, /платежа|списания|обработки|проводки/), find(/дата/)].find((i) => i >= 0) ?? -1
  // У Т-Банка «Сумма операции» — в валюте покупки, «Сумма платежа» — в валюте карты; нам нужна вторая.
  const amount = [find(/сумма платежа|в валюте (сч[её]та|карты)/, notAmount), find(/^сумма операции$/, notAmount), find(/^сумма/, notAmount), find(/сумма/, notAmount)].find((i) => i >= 0) ?? -1
  const income = find(/^(приход|поступлен|зачислен|кредит)/)
  const expense = find(/^(расход|списан|дебет)/)
  if (date < 0 || (amount < 0 && (income < 0 || expense < 0))) return null

  const nextCurrency = amount >= 0 && /валют/.test(h[amount + 1] ?? '') ? amount + 1 : -1
  const description = [find(/^описание/), find(/назначение/), find(/контрагент|получатель|наименование|детали|место/)].filter((i) => i >= 0)
  return {
    date,
    amount,
    income,
    expense,
    currency: nextCurrency >= 0 ? nextCurrency : find(/валюта/),
    description: [...new Set(description)],
    category: find(/^категория/),
    mcc: find(/^mcc/),
    status: find(/^статус/),
  }
}

function bankByHeader(header: string[]): string {
  const h = header.join(' ').toLowerCase()
  if (h.includes('дата платежа') && h.includes('номер карты')) return 'Т-Банк'
  if (h.includes('референс проводки') || h.includes('код авторизации')) return 'Альфа-Банк'
  return 'Выписка'
}

/** Разбирает таблицу выписки: ищет строку заголовков и столбцы даты, суммы и описания. */
export function parseStatementTable(table: string[][]): Statement {
  const headerIndex = table.slice(0, 40).findIndex((r) => findColumns(r) !== null)
  if (headerIndex < 0) throw new Error('Не нашли в файле столбцы с датой и суммой операции')
  const header = table[headerIndex]
  const cols = findColumns(header)!

  const parsed: { row: StatementRow; signed: boolean }[] = []
  for (const r of table.slice(headerIndex + 1)) {
    const date = parseStatementDate(r[cols.date] ?? '')
    if (!date) continue
    if (cols.status >= 0 && /fail|отклон|отмен/i.test(r[cols.status] ?? '')) continue

    let amount: number | null
    let signed = true
    if (cols.amount >= 0) {
      const raw = r[cols.amount] ?? ''
      amount = parseMoney(raw)
      signed = /^[\s]*[+\-−]/.test(raw)
    } else {
      const plus = parseMoney(r[cols.income] ?? '') ?? 0
      const minus = parseMoney(r[cols.expense] ?? '') ?? 0
      amount = Math.abs(plus) - Math.abs(minus)
    }
    if (!amount) continue

    const { description, mcc } = cleanDescription(cols.description.map((i) => r[i] ?? '').filter(Boolean).join(' · '))
    parsed.push({
      signed,
      row: {
        date,
        amount,
        currency: normalizeCurrency(cols.currency >= 0 ? (r[cols.currency] ?? '') : ''),
        description,
        bankCategory: cols.category >= 0 ? (r[cols.category] ?? '') : '',
        mcc: (cols.mcc >= 0 ? r[cols.mcc] : '') || mcc,
      },
    })
  }
  return { bank: bankByHeader(header), rows: fixUnsigned(parsed) }
}

/**
 * Если банк ставит знак только у поступлений («+24 000,00»), а списания пишет без знака,
 * беззнаковые суммы — это списания. Если знаков нет вовсе, решаем по словам в описании.
 */
function fixUnsigned(parsed: { row: StatementRow; signed: boolean }[]): StatementRow[] {
  const anyNegative = parsed.some((p) => p.row.amount < 0)
  if (anyNegative) return parsed.map((p) => p.row)
  const plusMarked = parsed.some((p) => p.signed)
  return parsed.map(({ row, signed }) => {
    if (signed) return row
    const income = !plusMarked && INCOME_WORDS.test(`${row.description} ${row.bankCategory}`)
    return income ? row : { ...row, amount: -row.amount }
  })
}

function normalizeCurrency(text: string): string | null {
  const s = text.trim().toUpperCase()
  if (!s) return null
  if (s === 'RUR' || s === '₽' || s === 'РУБ' || s === 'РУБ.') return 'RUB'
  return /^[A-Z]{3}$/.test(s) ? s : null
}

// --- PDF: строки текста ------------------------------------------------------------------

const DATE_START = /^(\d{2}\.\d{2}\.\d{4})/
// Строка операции в выписке Сбербанка: «21.10.2026 14:32 Супермаркеты 1 240,50 125 740,00».
const SBER_LINE = /^(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}\s+(.+?)\s+([+]?\d{1,3}(?:[\s ]\d{3})*,\d{2})\s+(-?\d{1,3}(?:[\s ]\d{3})*,\d{2})$/
// Вторая строка у Сбербанка: дата обработки, код авторизации и описание.
const SBER_DETAILS = /^\d{2}\.\d{2}\.\d{4}\s+(?:\d{6}|-|—)?\s*(.*)$/

/** Разбирает выписку из PDF, уже превращённую в строки текста. */
export function parseStatementLines(lines: string[]): Statement {
  const clean = lines.map((l) => l.replace(SPACES, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const text = clean.join('\n')
  if (/сбербанк|sberbank/i.test(text) && clean.some((l) => SBER_LINE.test(l))) return { bank: 'Сбербанк', rows: parseSber(clean) }
  const bank = /т-?банк|тинькофф|tinkoff|tbank/i.test(text) ? 'Т-Банк' : /альфа-банк|alfa-bank|альфа банк/i.test(text) ? 'Альфа-Банк' : 'Выписка'
  return { bank, rows: parseGenericLines(clean) }
}

function parseSber(lines: string[]): StatementRow[] {
  const rows: StatementRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = SBER_LINE.exec(lines[i])
    if (!m) continue
    const amount = parseMoney(m[3])
    const date = parseStatementDate(m[1])
    if (!amount || !date) continue
    // Описание — на следующей строке (иногда переносится ещё на одну), до начала следующей операции.
    const details: string[] = []
    for (let j = i + 1; j < lines.length && j <= i + 3 && !SBER_LINE.test(lines[j]); j++) {
      const d = j === i + 1 ? SBER_DETAILS.exec(lines[j]) : null
      if (j === i + 1 && !d) break
      if (j > i + 1 && (DATE_START.test(lines[j]) || SUMMARY_WORDS.test(lines[j]))) break
      details.push(d ? d[1] : lines[j])
    }
    const { description, mcc } = cleanDescription(details.join(' ') || m[2])
    rows.push({
      date,
      amount: m[3].startsWith('+') ? amount : -amount,
      currency: 'RUB',
      description: description || m[2],
      bankCategory: m[2],
      mcc,
    })
  }
  return rows
}

/**
 * Общий разбор: операция начинается со строки с датой и может продолжаться на следующих строках.
 * Из неё берём первую дату, сумму (со знаком, если он есть) и всё остальное как описание.
 */
function parseGenericLines(lines: string[]): StatementRow[] {
  const records: string[] = []
  for (const line of lines) {
    if (DATE_START.test(line)) records.push(line)
    else if (records.length > 0 && !SUMMARY_WORDS.test(line) && records[records.length - 1].split('\n').length < 4) {
      records[records.length - 1] += '\n' + line
    }
  }

  const parsed: { row: StatementRow; signed: boolean }[] = []
  for (const record of records) {
    const flat = record.replace(/\n/g, ' ')
    const date = parseStatementDate(flat)
    const amounts = [...flat.matchAll(MONEY)].map((m) => m[0].trim())
    if (!date || amounts.length === 0) continue
    const signedAmount = amounts.find((a) => /^[+\-−]/.test(a))
    const raw = signedAmount ?? amounts[0]
    const amount = parseMoney(raw)
    if (!amount) continue
    const rest = flat
      .replace(/\d{2}\.\d{2}\.\d{2,4}/g, ' ')
      .replace(/\d{2}:\d{2}(:\d{2})?/g, ' ')
      .replace(MONEY, ' ')
      .replace(/₽|RUR|RUB|руб\.?/gi, ' ')
    const { description, mcc } = cleanDescription(rest)
    if (!description || SUMMARY_WORDS.test(description)) continue
    parsed.push({ signed: !!signedAmount, row: { date, amount, currency: null, description, bankCategory: '', mcc } })
  }
  return fixUnsigned(parsed)
}
