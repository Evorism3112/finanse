import { describe, expect, test } from 'vitest'
import { defaultAccount, pickingOrder } from './accountKinds'
import type { Account, Category, Transaction } from './db'
import { cleanDescription, decodeText, parseCsv, parseMoney, parseStatementDate, parseStatementLines, parseStatementTable } from './statement'
import { unzip, xlsxTable } from './statementFiles'
import { merchantKey, prepareImport } from './statementImport'

const synced = { createdAt: 1, updatedAt: 1, deletedAt: null }

/** Кодирует текст в Windows-1251 — так Т-Банк отдаёт CSV. */
function cp1251(text: string): Uint8Array {
  return Uint8Array.from([...text], (ch) => {
    const c = ch.charCodeAt(0)
    if (c < 0x80) return c
    if (c >= 0x410 && c <= 0x44f) return c - 0x350
    if (ch === 'Ё') return 0xa8
    if (ch === 'ё') return 0xb8
    if (ch === '№') return 0xb9
    throw new Error(`нет в таблице: ${ch}`)
  })
}

describe('суммы и даты выписок', () => {
  test('parseMoney понимает разные записи', () => {
    expect(parseMoney('-1 240,50')).toBe(-124050)
    expect(parseMoney('−1 240,50 ₽')).toBe(-124050)
    expect(parseMoney('+24 000,00')).toBe(2400000)
    expect(parseMoney('1240.50 RUR')).toBe(124050)
    expect(parseMoney('1,240.50')).toBe(124050)
    expect(parseMoney('1 240')).toBe(124000)
    expect(parseMoney('итого')).toBeNull()
  })

  test('parseStatementDate', () => {
    expect(parseStatementDate('21.10.2026 14:32:11')).toBe('2026-10-21')
    expect(parseStatementDate('21.10.26')).toBe('2026-10-21')
    expect(parseStatementDate('2026-10-21')).toBe('2026-10-21')
    expect(parseStatementDate('46316')).toBe('2026-10-21')
    expect(parseStatementDate('46316.6')).toBe('2026-10-21')
    expect(parseStatementDate('31.02.2026')).toBeNull()
    expect(parseStatementDate('Пятёрочка')).toBeNull()
  })

  test('cleanDescription вытаскивает магазин из служебных строк', () => {
    expect(cleanDescription('220015++++++1234    1234567\\RUS\\MOSCOW\\PYATEROCHKA 1234      21.10.26 19.10.26      1240.50  RUR MCC5411')).toEqual({
      description: 'PYATEROCHKA 1234',
      mcc: '5411',
    })
    expect(
      cleanDescription('Операция по карте: 220015++++++1234, дата создания транзакции: 19.10.2026, место совершения: RU/MOSCOW/VKUSVILL, MCC5411').description,
    ).toBe('VKUSVILL')
    expect(cleanDescription('PYATEROCHKA Moscow RUS. Операция по карте ****1234').description).toBe('PYATEROCHKA Moscow RUS')
  })
})

describe('таблицы', () => {
  test('CSV Т-Банка в Windows-1251: знак суммы, неуспешные пропускаются, сумма в валюте карты', () => {
    const csv = [
      '"Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";"MCC";"Описание";"Бонусы (включая кэшбэк)"',
      '"21.10.2026 14:32:11";"22.10.2026";"*1234";"OK";"-1240,50";"RUB";"-1240,50";"RUB";"";"Супермаркеты";"5411";"Пятёрочка";"12,00"',
      '"21.10.2026 10:00:00";"21.10.2026";"*1234";"FAILED";"-500,00";"RUB";"-500,00";"RUB";"";"Кафе";"5814";"Кофейня";"0,00"',
      '"20.10.2026 09:00:00";"20.10.2026";"";"OK";"24000,00";"RUB";"24000,00";"RUB";"";"Пополнения";"";"Зарплата ООО Ромашка";"0,00"',
      '"19.10.2026 18:00:00";"20.10.2026";"*1234";"OK";"-10,00";"USD";"-950,00";"RUB";"";"Сервис";"5734";"Steam";"0,00"',
    ].join('\r\n')
    const s = parseStatementTable(parseCsv(decodeText(cp1251(csv))))
    expect(s.bank).toBe('Т-Банк')
    expect(s.rows).toEqual([
      { date: '2026-10-21', amount: -124050, currency: 'RUB', description: 'Пятёрочка', bankCategory: 'Супермаркеты', mcc: '5411' },
      { date: '2026-10-20', amount: 2400000, currency: 'RUB', description: 'Зарплата ООО Ромашка', bankCategory: 'Пополнения', mcc: '' },
      { date: '2026-10-19', amount: -95000, currency: 'RUB', description: 'Steam', bankCategory: 'Сервис', mcc: '5734' },
    ])
  })

  test('старый CSV Альфы: отдельные столбцы прихода и расхода, заголовок не в первой строке', () => {
    const csv = [
      'Выписка по счёту',
      'Тип счёта;Номер счета;Валюта;Дата операции;Референс проводки;Описание операции;Приход;Расход;',
      'Текущий счёт;40817810000000001234;RUR;21.10.26;CRD_1;220015++++++1234    1234567\\RUS\\MOSCOW\\PYATEROCHKA 1234      21.10.26 19.10.26      1240.50  RUR MCC5411;0;1240,5;',
      'Текущий счёт;40817810000000001234;RUR;20.10.26;MO_2;Перевод от Иванов И.И.;5000;0;',
    ].join('\n')
    const s = parseStatementTable(parseCsv(csv))
    expect(s.bank).toBe('Альфа-Банк')
    expect(s.rows.map((r) => [r.date, r.amount, r.description, r.mcc])).toEqual([
      ['2026-10-21', -124050, 'PYATEROCHKA 1234', '5411'],
      ['2026-10-20', 500000, 'Перевод от Иванов И.И.', ''],
    ])
  })

  test('без знаков у сумм поступления узнаются по описанию', () => {
    const s = parseStatementTable([
      ['Дата', 'Сумма', 'Описание'],
      ['21.10.2026', '1 240,50', 'Магазин'],
      ['20.10.2026', '24 000,00', 'Зачисление зарплаты'],
    ])
    expect(s.rows.map((r) => r.amount)).toEqual([-124050, 2400000])
  })

  test('файл без нужных столбцов', () => {
    expect(() => parseStatementTable([['Имя', 'Телефон']])).toThrow(/столбцы/)
  })

  test('xlsx: общие строки, числа, пропущенные ячейки', async () => {
    const zip = await makeZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Выписка" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Дата операции</t></si><si><t>Сумма</t></si><si><r><t>Описание</t></r></si><si><t>Кафе &amp; бар</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2"><v>46316</v></c><c r="B2"><v>-650.00000000001</v></c><c r="C2" t="s"><v>3</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>20.10.2026</t></is></c><c r="C3" t="str"><v>пусто</v></c></row>' +
        '</sheetData></worksheet>',
    })
    const table = await xlsxTable(zip)
    expect(table).toEqual([
      ['Дата операции', 'Сумма', 'Описание'],
      ['46316', '-650.00', 'Кафе & бар'],
      ['20.10.2026', '', 'пусто'],
    ])
    expect(parseStatementTable(table).rows).toEqual([
      { date: '2026-10-21', amount: -65000, currency: null, description: 'Кафе & бар', bankCategory: '', mcc: '' },
    ])
    expect((await unzip(zip)).size).toBe(4)
  })
})

describe('PDF', () => {
  test('выписка Сбербанка: знак только у поступлений, описание на второй строке', () => {
    const s = parseStatementLines([
      'ПАО Сбербанк',
      'Выписка по счёту дебетовой карты',
      'ДАТА ОПЕРАЦИИ (МСК) КАТЕГОРИЯ СУММА В ВАЛЮТЕ СЧЁТА ОСТАТОК СРЕДСТВ',
      '21.10.2026 14:32 Супермаркеты 1 240,50 125 740,00',
      '22.10.2026 263920 PYATEROCHKA 1234 Moscow RUS. Операция по карте ****1234',
      '20.10.2026 09:00 Перевод СБП +24 000,00 126 980,50',
      '20.10.2026 - Иванов И. И. Операция по счёту ****5678',
      '19.10.2026 18:10 Рестораны и кафе 650,00 102 980,50',
      '19.10.2026 112233 COFFEE POINT',
      'Moscow RUS',
      'Итого по операциям',
    ])
    expect(s.bank).toBe('Сбербанк')
    expect(s.rows.map((r) => [r.date, r.amount, r.description, r.bankCategory])).toEqual([
      ['2026-10-21', -124050, 'PYATEROCHKA 1234 Moscow RUS', 'Супермаркеты'],
      ['2026-10-20', 2400000, 'Иванов И. И.', 'Перевод СБП'],
      ['2026-10-19', -65000, 'COFFEE POINT Moscow RUS', 'Рестораны и кафе'],
    ])
  })

  test('общий разбор: суммы со знаком, перенос описания, итоги пропускаются', () => {
    const s = parseStatementLines([
      'АО «ТБанк» Справка о движении средств',
      'Дата и время операции Дата списания Сумма в валюте операции Сумма операции в валюте карты Описание операции',
      '21.10.2026 14:32 22.10.2026 -1 240,50 ₽ -1 240,50 ₽ Оплата в PYATEROCHKA',
      'MOSCOW RUS',
      '20.10.2026 09:00 20.10.2026 +24 000,00 ₽ +24 000,00 ₽ Пополнение. Зарплата',
      'Итого поступлений +24 000,00 ₽',
    ])
    expect(s.bank).toBe('Т-Банк')
    expect(s.rows.map((r) => [r.date, r.amount, r.description])).toEqual([
      ['2026-10-21', -124050, 'Оплата в PYATEROCHKA MOSCOW RUS'],
      ['2026-10-20', 2400000, 'Пополнение. Зарплата'],
    ])
  })
})

const account = (id: string, name: string, kind: Account['kind'] = 'regular', favorite = false, updatedAt = 1): Account => ({
  ...synced,
  updatedAt,
  id,
  name,
  kind,
  currency: 'RUB',
  initialBalance: 0,
  creditLimit: null,
  interestRate: null,
  targetAmount: null,
  interestDebt: 0,
  graceDate: null,
  graceAmount: null,
  graceRemindDays: 7,
  paymentAmount: null,
  nextPaymentDate: null,
  paymentRemindDays: 3,
  favorite,
  statementDay: null,
})

describe('основной счёт', () => {
  test('основной идёт первым и подставляется по умолчанию', () => {
    const list = [account('s', 'Сбер'), account('a', 'Альфа', 'regular', true), account('t', 'Т-Банк')]
    expect(pickingOrder(list).map((a) => a.name)).toEqual(['Альфа', 'Сбер', 'Т-Банк'])
    expect(defaultAccount(list)?.id).toBe('a')
  })

  test('без основного — первый по алфавиту из тех, которыми платят', () => {
    const list = [account('t', 'Т-Банк'), account('l', 'Автокредит', 'loan'), account('s', 'Сбер', 'credit_card')]
    expect(pickingOrder(list).map((a) => a.name)).toEqual(['Автокредит', 'Сбер', 'Т-Банк'])
    expect(defaultAccount(list)?.id).toBe('s')
    expect(defaultAccount([account('l', 'Автокредит', 'loan')])?.id).toBe('l')
    expect(defaultAccount([])).toBeUndefined()
  })

  test('две звёздочки после синхронизации: главный тот, что отмечен позже', () => {
    const list = [account('a', 'Альфа', 'regular', true, 5), account('s', 'Сбер', 'regular', true, 9)]
    expect(defaultAccount(list)?.id).toBe('s')
    expect(pickingOrder(list).map((a) => a.id)).toEqual(['s', 'a'])
  })
})

describe('подготовка импорта', () => {
  const category = (id: string, name: string, kind: Category['kind']): Category => ({ ...synced, id, name, kind, budget: null })
  const categories = [
    category('food', 'Продукты', 'expense'),
    category('cafe', 'Кафе и рестораны', 'expense'),
    category('fun', 'Развлечения', 'expense'),
    category('salary', 'Зарплата', 'income'),
  ]
  const tx = (fields: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount' | 'date'>): Transaction => ({
    ...synced,
    accountId: 'card',
    toAccountId: null,
    toAmount: null,
    categoryId: null,
    note: '',
    ...fields,
  })
  const row = (date: string, amount: number, description = '', extra: Partial<{ bankCategory: string; mcc: string }> = {}) => ({
    date,
    amount,
    currency: 'RUB',
    description,
    bankCategory: extra.bankCategory ?? '',
    mcc: extra.mcc ?? '',
  })

  test('дубли: та же сумма в пределах двух дней, каждая операция закрывает одну строку', () => {
    const existing = [
      tx({ id: 'coffee', type: 'expense', amount: 25000, date: '2026-10-20' }),
      tx({ id: 'other-account', type: 'expense', amount: 99900, date: '2026-10-20', accountId: 'cash' }),
      tx({ id: 'to-card', type: 'transfer', amount: 500000, date: '2026-10-19', accountId: 'cash', toAccountId: 'card' }),
      tx({ id: 'old', type: 'expense', amount: 77700, date: '2026-10-10' }),
    ]
    const items = prepareImport(
      [row('2026-10-21', -25000), row('2026-10-21', -25000), row('2026-10-20', -99900), row('2026-10-20', 500000), row('2026-10-13', -77700)],
      'card',
      existing,
      categories,
    )
    expect(items.map((i) => i.duplicateOf)).toEqual(['coffee', null, null, 'to-card', null])
    expect(items.map((i) => [i.type, i.amount])).toEqual([
      ['expense', 25000],
      ['expense', 25000],
      ['expense', 99900],
      ['income', 500000],
      ['expense', 77700],
    ])
  })

  test('категории: сначала запомненная по магазину, потом по категории банка и MCC', () => {
    const existing = [
      tx({ id: 'a', type: 'expense', amount: 100, date: '2026-09-01', note: 'PYATEROCHKA 1234', categoryId: 'fun', updatedAt: 1 }),
      tx({ id: 'b', type: 'expense', amount: 100, date: '2026-09-02', note: 'Pyaterochka 5678', categoryId: 'food', updatedAt: 2 }),
    ]
    const items = prepareImport(
      [
        row('2026-10-21', -124050, 'PYATEROCHKA 9999', { bankCategory: 'Развлечения' }),
        row('2026-10-21', -65000, 'COFFEE POINT', { mcc: '5814' }),
        row('2026-10-21', -30000, 'Что-то', { bankCategory: 'Рестораны и кафе' }),
        row('2026-10-20', 2400000, 'Зарплата ООО Ромашка'),
        row('2026-10-20', -1000, 'Неизвестно'),
      ],
      'card',
      existing,
      categories,
    )
    expect(items.map((i) => i.categoryId)).toEqual(['food', 'cafe', 'cafe', 'salary', null])
  })

  test('merchantKey не зависит от цифр, регистра и знаков', () => {
    expect(merchantKey('PYATEROCHKA 1234 Moscow')).toBe(merchantKey('Pyaterochka, 99 MOSCOW'))
    expect(merchantKey('Пятёрочка')).toBe('пятерочка')
  })
})

/** Собирает ZIP со сжатыми файлами — как Excel. */
async function makeZip(files: Record<string, string>): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name)
    const stream = new Blob([enc.encode(content)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    const data = new Uint8Array(await new Response(stream).arrayBuffer())
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, 8, true)
    lv.setUint32(18, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, 8, true)
    cv.setUint32(20, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let p = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p)
    p += part.length
  }
  return out
}
