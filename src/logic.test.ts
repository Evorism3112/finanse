import { describe, expect, test } from 'vitest'
import { accountLabel } from './accountKinds'
import { assignSlots } from './chartColors'
import { dayLabel, formatDate, parseDate, shiftMonth } from './dates'
import { normalizeCategory, normalizeSubscription } from './db'
import { normalizeAccount, type Account, type Category, type Subscription, type Transaction } from './db'
import { parseBackup, pickNewer } from './merge'
import { amountToInput, parseAmount, parseRate } from './money'
import {
  addPeriod,
  daysUntil,
  dueText,
  installmentAt,
  installmentsTotal,
  isDue,
  monthlyCost,
  monthlyTotals,
  nextInstallment,
  reminderText,
  upcomingInstallment,
} from './subscriptions'
import {
  accountReminders,
  graceDueText,
  graceRowText,
  graceToPay,
  isGraceDue,
  isPaymentDue,
  paymentDueText,
  paymentReminder,
} from './payments'
import { budgetRows, creditUsage, mainCurrency, monthlySeries } from './stats'
import { accountBalances, monthlyInterest, monthReport, netWorthByCurrency } from './stats'

const synced = { createdAt: 1, updatedAt: 1, deletedAt: null }

const account = (id: string, currency: string, initialBalance = 0): Account => ({
  ...synced,
  id,
  name: id,
  kind: 'regular',
  currency,
  initialBalance,
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
})

const tx = (fields: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  ...synced,
  id: Math.random().toString(36),
  accountId: 'card',
  toAccountId: null,
  toAmount: null,
  categoryId: null,
  date: '2026-10-05',
  note: '',
  ...fields,
})

describe('parseAmount', () => {
  test.each([
    ['100', 10000],
    ['1 234,56', 123456],
    ['0.5', 50],
    ['12,3', 1230],
    ['-15,10', -1510],
    ['0,29', 29],
    ['-0', 0],
  ])('%s → %d', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })

  test.each(['', 'abc', '1,234', '1.2.3', '--5', '5-'])('отклоняет «%s»', (input) => {
    expect(parseAmount(input)).toBeNull()
  })

  test('parseRate', () => {
    expect(parseRate('16')).toBe(16)
    expect(parseRate(' 18,5 ')).toBe(18.5)
    expect(parseRate('0.1')).toBe(0.1)
    for (const bad of ['', '-5', 'abc', '5%', '2000']) expect(parseRate(bad)).toBeNull()
  })

  test('amountToInput обратим', () => {
    expect(amountToInput(123456)).toBe('1234,56')
    expect(parseAmount(amountToInput(-1510))).toBe(-1510)
  })
})

describe('accountBalances', () => {
  const accounts = [account('card', 'RUB', 100000), account('cash', 'RUB'), account('usd', 'USD')]

  test('доходы, расходы и переводы', () => {
    const balances = accountBalances(accounts, [
      tx({ type: 'income', amount: 50000 }),
      tx({ type: 'expense', amount: 12050 }),
      tx({ type: 'transfer', amount: 30000, toAccountId: 'cash' }),
      tx({ type: 'transfer', amount: 90000, toAccountId: 'usd', toAmount: 1000 }),
    ])
    expect(balances.get('card')).toBe(100000 + 50000 - 12050 - 30000 - 90000)
    expect(balances.get('cash')).toBe(30000)
    expect(balances.get('usd')).toBe(1000)
    expect(netWorthByCurrency(accounts, balances)).toEqual([
      { currency: 'RUB', assets: 47950, debts: 0 },
      { currency: 'USD', assets: 1000, debts: 0 },
    ])
  })

  test('долги по кредитам и кредитным картам', () => {
    const withDebts = [
      account('card', 'RUB', 100000),
      { ...account('credit', 'RUB'), kind: 'credit_card' as const, creditLimit: 5000000 },
      { ...account('loan', 'RUB', -80000000), kind: 'loan' as const, interestRate: 18 },
    ]
    const balances = accountBalances(withDebts, [
      tx({ type: 'expense', amount: 250000, accountId: 'credit' }),
      tx({ type: 'transfer', amount: 50000, toAccountId: 'credit' }),
      tx({ type: 'transfer', amount: 20000, toAccountId: 'loan' }),
      tx({ type: 'expense', amount: 1200000, accountId: 'loan' }),
    ])
    expect(balances.get('card')).toBe(30000)
    expect(balances.get('credit')).toBe(-200000)
    expect(balances.get('loan')).toBe(-81180000)
    expect(netWorthByCurrency(withDebts, balances)).toEqual([{ currency: 'RUB', assets: 30000, debts: 81380000 }])
  })

  test('creditUsage: проценты в долге не занимают лимит', () => {
    expect(creditUsage(30000000, -22803149, 0)).toEqual({ used: 22803149, available: 7196851 })
    expect(creditUsage(30000000, -22803149, 790363)).toEqual({ used: 22012786, available: 7987214 })
    // Проценты не могут быть больше самого долга.
    expect(creditUsage(10000000, -50000, 90000)).toEqual({ used: 0, available: 10000000 })
    expect(creditUsage(10000000, 0, 0)).toEqual({ used: 0, available: 10000000 })
    expect(creditUsage(10000000, 250000, 0)).toEqual({ used: 0, available: 10250000 })
  })

  test('monthlyInterest', () => {
    expect(monthlyInterest(15000000, 16)).toBe(200000)
    expect(monthlyInterest(-80000000, 18)).toBe(1200000)
    expect(monthlyInterest(0, 18)).toBe(0)
  })
})

describe('monthReport', () => {
  const accounts = [account('card', 'RUB'), account('usd', 'USD')]

  test('считает только нужный месяц, без переводов, по валютам', () => {
    const report = monthReport(
      accounts,
      [
        tx({ type: 'income', amount: 100000, categoryId: 'salary' }),
        tx({ type: 'expense', amount: 3000, categoryId: 'food' }),
        tx({ type: 'expense', amount: 7000, categoryId: 'food' }),
        tx({ type: 'expense', amount: 20000, categoryId: 'rent' }),
        tx({ type: 'expense', amount: 500 }),
        tx({ type: 'expense', amount: 999, date: '2026-09-30' }),
        tx({ type: 'transfer', amount: 5000, toAccountId: 'usd', toAmount: 50 }),
        tx({ type: 'expense', amount: 1500, accountId: 'usd' }),
      ],
      '2026-10',
    )
    expect(report).toEqual([
      {
        currency: 'RUB',
        income: 100000,
        expense: 30500,
        incomeByCategory: [{ categoryId: 'salary', amount: 100000 }],
        expenseByCategory: [
          { categoryId: 'rent', amount: 20000 },
          { categoryId: 'food', amount: 10000 },
          { categoryId: null, amount: 500 },
        ],
      },
      {
        currency: 'USD',
        income: 0,
        expense: 1500,
        incomeByCategory: [],
        expenseByCategory: [{ categoryId: null, amount: 1500 }],
      },
    ])
  })
})

describe('слияние копий', () => {
  test('pickNewer берёт новые и более поздние записи', () => {
    const local = [
      { ...synced, id: 'a', updatedAt: 10 },
      { ...synced, id: 'b', updatedAt: 10 },
      { ...synced, id: 'c', updatedAt: 10 },
    ]
    const incoming = [
      { ...synced, id: 'a', updatedAt: 5 },
      { ...synced, id: 'b', updatedAt: 20, deletedAt: 20 },
      { ...synced, id: 'c', updatedAt: 10 },
      { ...synced, id: 'd', updatedAt: 1 },
    ]
    expect(pickNewer(local, incoming).map((r) => r.id)).toEqual(['b', 'd'])
  })

  test('parseBackup проверяет файл', () => {
    const good = { app: 'finanse', version: 1, exportedAt: 0, accounts: [], categories: [], transactions: [] }
    // Копия без подписок (старый формат) читается с пустым списком.
    expect(parseBackup(JSON.stringify(good))).toEqual({ ...good, subscriptions: [] })
    expect(() => parseBackup(JSON.stringify({ ...good, subscriptions: [{ id: 1 }] }))).toThrow()
    expect(() => parseBackup('не json')).toThrow()
    expect(() => parseBackup('null')).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...good, app: 'other' }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...good, version: 2 }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...good, accounts: [{ id: 1 }] }))).toThrow()
  })

  test('счета из старой копии получают тип «обычный»', () => {
    const old = { ...synced, id: 'a', name: 'Карта', currency: 'RUB', initialBalance: 5 } as Account
    const expected = {
      ...old,
      kind: 'regular',
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
    }
    expect(normalizeAccount(old)).toEqual(expected)
    const backup = { app: 'finanse', version: 1, exportedAt: 0, accounts: [old], categories: [], transactions: [] }
    expect(parseBackup(JSON.stringify(backup)).accounts).toEqual([expected])
    const loan = { ...expected, kind: 'loan' as const, interestRate: 18 }
    expect(normalizeAccount(loan)).toEqual(loan)
  })
})

test('shiftMonth переходит через границу года', () => {
  expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  expect(shiftMonth('2026-10', 0)).toBe('2026-10')
})

describe('подписки', () => {
  const subscription = (fields: Partial<Subscription> = {}): Subscription => ({
    ...synced,
    id: 's',
    direction: 'expense',
    installments: null,
    name: 'Музыка',
    amount: 29900,
    currency: 'RUB',
    period: 'month',
    nextDate: '2026-10-15',
    autoRenew: true,
    accountId: null,
    categoryId: null,
    remindDays: 3,
    note: '',
    ...fields,
  })

  test('addPeriod', () => {
    expect(addPeriod('2026-10-15', 'month')).toBe('2026-11-15')
    expect(addPeriod('2026-12-15', 'month')).toBe('2027-01-15')
    expect(addPeriod('2026-01-31', 'month')).toBe('2026-02-28')
    expect(addPeriod('2028-01-31', 'month')).toBe('2028-02-29')
    expect(addPeriod('2026-10-15', 'year')).toBe('2027-10-15')
    expect(addPeriod('2028-02-29', 'year')).toBe('2029-02-28')
    expect(addPeriod('2026-12-28', 'week')).toBe('2027-01-04')
  })

  test('daysUntil', () => {
    expect(daysUntil('2026-10-15', '2026-10-12')).toBe(3)
    expect(daysUntil('2026-10-12', '2026-10-12')).toBe(0)
    expect(daysUntil('2026-10-10', '2026-10-12')).toBe(-2)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
    // Переход на летнее время не должен съедать день.
    expect(daysUntil('2026-03-30', '2026-03-28')).toBe(2)
  })

  test('isDue учитывает срок напоминания', () => {
    const s = subscription()
    expect(isDue(s, '2026-10-11')).toBe(false)
    expect(isDue(s, '2026-10-12')).toBe(true)
    expect(isDue(s, '2026-10-15')).toBe(true)
    expect(isDue(s, '2026-10-20')).toBe(true)
    expect(isDue(subscription({ remindDays: 0 }), '2026-10-14')).toBe(false)
  })

  test('стоимость в месяц', () => {
    expect(monthlyCost(29900, 'month')).toBe(29900)
    expect(monthlyCost(120000, 'year')).toBe(10000)
    expect(monthlyCost(30000, 'week')).toBe(130000)
    expect(
      monthlyTotals([subscription(), subscription({ amount: 120000, period: 'year' }), subscription({ currency: 'USD', amount: 999 })]),
    ).toEqual([
      ['RUB', 39900],
      ['USD', 999],
    ])
  })

  test('тексты напоминаний', () => {
    expect(dueText(subscription(), '2026-10-12')).toBe('списание через 3 дн.')
    expect(dueText(subscription(), '2026-10-14')).toBe('списание завтра')
    expect(dueText(subscription(), '2026-10-15')).toBe('списание сегодня')
    expect(dueText(subscription(), '2026-10-17')).toBe('платёж просрочен на 2 дн.')
    expect(dueText(subscription({ autoRenew: false }), '2026-10-14')).toBe('заканчивается завтра')
    expect(dueText(subscription({ autoRenew: false }), '2026-10-16')).toBe('закончилась 1 дн. назад')
    const salary = subscription({ direction: 'income', name: 'Зарплата' })
    expect(dueText(salary, '2026-10-12')).toBe('поступление через 3 дн.')
    expect(dueText(salary, '2026-10-15')).toBe('поступление сегодня')
    expect(dueText(salary, '2026-10-17')).toBe('поступление ожидалось 2 дн. назад')
    const { title, body } = reminderText(subscription(), '2026-10-14')
    expect(title).toBe('Музыка')
    expect(body.replace(/\s/g, ' ')).toBe('Списание завтра · 299,00 ₽')
  })
})

describe('взносы по кредитам', () => {
  const loan: Account = {
    ...account('loan', 'RUB', -80000000),
    name: 'Автокредит',
    kind: 'loan',
    paymentAmount: 2500000,
    nextPaymentDate: '2026-10-15',
  }

  test('isPaymentDue', () => {
    expect(isPaymentDue(loan, -80000000, '2026-10-11')).toBe(false)
    expect(isPaymentDue(loan, -80000000, '2026-10-12')).toBe(true)
    expect(isPaymentDue(loan, -80000000, '2026-10-20')).toBe(true)
    // Долга нет — напоминать не о чем.
    expect(isPaymentDue(loan, 0, '2026-10-15')).toBe(false)
    expect(isPaymentDue({ ...loan, nextPaymentDate: null }, -80000000, '2026-10-15')).toBe(false)
    expect(isPaymentDue({ ...loan, paymentRemindDays: 0 }, -80000000, '2026-10-14')).toBe(false)
  })

  test('тексты', () => {
    expect(paymentDueText('2026-10-15', '2026-10-12')).toBe('платёж через 3 дн.')
    expect(paymentDueText('2026-10-15', '2026-10-14')).toBe('платёж завтра')
    expect(paymentDueText('2026-10-15', '2026-10-15')).toBe('платёж сегодня')
    expect(paymentDueText('2026-10-15', '2026-10-17')).toBe('платёж просрочен на 2 дн.')
    const reminder = paymentReminder(loan, '2026-10-14')
    expect(reminder.id).toBe('loan')
    expect(reminder.title).toBe('Автокредит')
    expect(reminder.body.replace(/\s/g, ' ')).toBe('Платёж завтра · 25 000,00 ₽')
    expect(paymentReminder({ ...loan, paymentAmount: null }, '2026-10-15').body).toBe('Платёж сегодня')
  })
})

describe('формат даты ДД.ММ.ГГ', () => {
  test('formatDate', () => {
    expect(formatDate('2026-10-12')).toBe('12.10.26')
    expect(formatDate('2027-01-05')).toBe('05.01.27')
    expect(formatDate('')).toBe('')
    expect(dayLabel('2026-10-12')).toBe('пн, 12.10.26')
  })

  test('parseDate', () => {
    expect(parseDate('12.10.26')).toBe('2026-10-12')
    expect(parseDate('05.01.27')).toBe('2027-01-05')
    expect(parseDate('29.02.28')).toBe('2028-02-29')
    for (const bad of ['', '12.10', '12.10.2026', '31.02.26', '29.02.27', '00.10.26', '12.13.26', '1.1.26']) {
      expect(parseDate(bad)).toBeNull()
    }
    expect(parseDate(formatDate('2026-12-31'))).toBe('2026-12-31')
  })
})

describe('цвета диаграммы', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']

  test('цвет привязан к записи и не зависит от состава диаграммы', () => {
    expect(assignSlots(order, ['c', 'a', 'b'])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
    // Убрали «a» — цвета оставшихся не изменились.
    expect(assignSlots(order, ['c', 'b'])).toEqual([
      ['b', 1],
      ['c', 2],
    ])
  })

  test('при совпадении берётся следующий свободный цвет, повторов нет', () => {
    // «a» и «i» претендуют на один цвет (0 и 8 % 8).
    expect(assignSlots(order, ['i', 'a', 'b'])).toEqual([
      ['a', 0],
      ['b', 1],
      ['i', 2],
    ])
    const slots = assignSlots(order, ['a', 'i', 'j', 'b', 'h']).map(([, slot]) => slot)
    expect(new Set(slots).size).toBe(slots.length)
  })

  test('неизвестные записи идут в конец и получают свободный цвет', () => {
    const [first, second] = assignSlots(['a', 'b'], ['x', 'b'])
    expect(first).toEqual(['b', 1])
    expect(second[0]).toBe('x')
    expect(second[1]).not.toBe(1)
  })
})

test('accountLabel добавляет пометку типа, если её нет в названии', () => {
  expect(accountLabel({ kind: 'regular', name: 'Карта' })).toBe('Счёт Карта')
  expect(accountLabel({ kind: 'regular', name: 'Зарплатный счет' })).toBe('Зарплатный счет')
  expect(accountLabel({ kind: 'savings', name: 'На отпуск' })).toBe('Накоп. На отпуск')
  expect(accountLabel({ kind: 'savings', name: 'Вклад' })).toBe('Вклад')
  expect(accountLabel({ kind: 'credit_card', name: 'Сбер-банк' })).toBe('Кредитка Сбер-банк')
  expect(accountLabel({ kind: 'credit_card', name: 'Кредитка Т-Банк' })).toBe('Кредитка Т-Банк')
  expect(accountLabel({ kind: 'loan', name: 'Машина' })).toBe('Кредит Машина')
  expect(accountLabel({ kind: 'loan', name: 'Автокредит' })).toBe('Автокредит')
  expect(accountLabel({ kind: 'loan', name: 'Ипотека' })).toBe('Ипотека')
})

describe('льготный период кредитной карты', () => {
  const card: Account = {
    ...account('sber', 'RUB'),
    name: 'Сбер-банк',
    kind: 'credit_card',
    creditLimit: 30000000,
    graceDate: '2026-11-25',
  }
  const debt = -22803149

  test('graceToPay: по умолчанию весь долг, иначе не больше долга', () => {
    expect(graceToPay(card, debt)).toBe(22803149)
    expect(graceToPay({ ...card, graceAmount: 5000000 }, debt)).toBe(5000000)
    expect(graceToPay({ ...card, graceAmount: 5000000 }, -100000)).toBe(100000)
    expect(graceToPay(card, 0)).toBe(0)
    expect(graceToPay({ ...card, graceDate: null }, debt)).toBe(0)
    // Льготный период есть только у кредитных карт.
    expect(graceToPay({ ...card, kind: 'loan' }, debt)).toBe(0)
  })

  test('isGraceDue учитывает срок напоминания', () => {
    expect(isGraceDue(card, debt, '2026-11-17')).toBe(false)
    expect(isGraceDue(card, debt, '2026-11-18')).toBe(true)
    expect(isGraceDue(card, debt, '2026-11-30')).toBe(true)
    expect(isGraceDue(card, 0, '2026-11-24')).toBe(false)
    expect(isGraceDue({ ...card, graceRemindDays: 30 }, debt, '2026-10-26')).toBe(true)
  })

  test('тексты', () => {
    expect(graceDueText('2026-11-25', '2026-11-20')).toBe('льготный период заканчивается через 5 дн.')
    expect(graceDueText('2026-11-25', '2026-11-24')).toBe('льготный период заканчивается завтра')
    expect(graceDueText('2026-11-25', '2026-11-25')).toBe('льготный период заканчивается сегодня')
    expect(graceDueText('2026-11-25', '2026-11-27')).toBe('льготный период истёк 2 дн. назад')
    const clean = (text: string) => text.replace(/\s/g, ' ')
    expect(clean(graceRowText(card, debt, '2026-10-12'))).toBe('без % до 25.11.26 · через 44 дн. · погасить 228 031,49 ₽')
    expect(clean(graceRowText(card, debt, '2026-11-27'))).toBe('льготный период истёк 2 дн. назад · 25.11.26 · не погашено 228 031,49 ₽')
  })

  test('accountReminders собирает взнос и льготный период отдельными напоминаниями', () => {
    const both = { ...card, nextPaymentDate: '2026-11-22', paymentAmount: 969150 }
    expect(accountReminders(both, debt, '2026-10-12')).toEqual([])
    const reminders = accountReminders(both, debt, '2026-11-20')
    expect(reminders.map((r) => r.id)).toEqual(['sber', 'sber:grace'])
    expect(reminders.map((r) => r.title)).toEqual(['Кредитка Сбер-банк', 'Кредитка Сбер-банк'])
    expect(reminders[1].text).toBe('льготный период заканчивается через 5 дн.')
    expect(reminders[1].body.replace(/\s/g, ' ')).toBe('Льготный период заканчивается через 5 дн. · погасить 228 031,49 ₽')
    expect(accountReminders(both, 0, '2026-11-20')).toEqual([])
  })
})

describe('лимиты и динамика', () => {
  const category = (id: string, budget: number | null, kind: Category['kind'] = 'expense') => ({ id, kind, budget })

  test('budgetRows: только расходные категории с лимитом, ближе к лимиту — выше', () => {
    const rows = budgetRows(
      [category('food', 1500000), category('fun', 500000), category('rent', null), category('salary', 100, 'income'), category('gifts', 300000)],
      [
        { categoryId: 'food', amount: 324050 },
        { categoryId: 'fun', amount: 620000 },
        { categoryId: 'rent', amount: 4000000 },
      ],
    )
    expect(rows).toEqual([
      { categoryId: 'fun', budget: 500000, spent: 620000 },
      { categoryId: 'food', budget: 1500000, spent: 324050 },
      { categoryId: 'gifts', budget: 300000, spent: 0 },
    ])
  })

  test('monthlySeries и mainCurrency', () => {
    const accounts = [account('card', 'RUB'), account('usd', 'USD')]
    const txs = [
      tx({ type: 'income', amount: 100, date: '2026-08-10' }),
      tx({ type: 'expense', amount: 40, date: '2026-08-11' }),
      tx({ type: 'expense', amount: 70, date: '2026-10-01' }),
      tx({ type: 'expense', amount: 5, date: '2026-10-01', accountId: 'usd' }),
    ]
    expect(monthlySeries(accounts, txs, 'RUB', ['2026-08', '2026-09', '2026-10'])).toEqual([
      { month: '2026-08', income: 100, expense: 40 },
      { month: '2026-09', income: 0, expense: 0 },
      { month: '2026-10', income: 0, expense: 70 },
    ])
    expect(mainCurrency(accounts)).toBe('RUB')
    expect(mainCurrency([])).toBe('RUB')
  })

  test('старые записи дополняются новыми полями', () => {
    expect(normalizeCategory({ id: 'c', name: 'Еда', kind: 'expense' } as Category).budget).toBeNull()
    expect(normalizeCategory({ id: 'c', name: 'Еда', kind: 'expense', budget: 5 } as Category).budget).toBe(5)
    expect(normalizeSubscription({ id: 's', name: 'Кино' } as Subscription).direction).toBe('expense')
    expect(normalizeSubscription({ id: 's', name: 'ЗП', direction: 'income' } as Subscription).direction).toBe('income')
  })
})

describe('доход несколькими выплатами в месяц', () => {
  // Аванс 25-го и основная часть 10-го: 60 000 в месяц.
  const parts = [
    { day: 10, amount: 3600000 },
    { day: 25, amount: 2400000 },
  ]

  test('upcomingInstallment: ближайшая выплата не раньше даты', () => {
    expect(upcomingInstallment(parts, '2026-10-01')).toEqual({ date: '2026-10-10', amount: 3600000 })
    expect(upcomingInstallment(parts, '2026-10-10')).toEqual({ date: '2026-10-10', amount: 3600000 })
    expect(upcomingInstallment(parts, '2026-10-12')).toEqual({ date: '2026-10-25', amount: 2400000 })
    expect(upcomingInstallment(parts, '2026-10-26')).toEqual({ date: '2026-11-10', amount: 3600000 })
    expect(upcomingInstallment(parts, '2026-12-26')).toEqual({ date: '2027-01-10', amount: 3600000 })
    // Порядок в списке не важен.
    expect(upcomingInstallment([...parts].reverse(), '2026-10-12')).toEqual({ date: '2026-10-25', amount: 2400000 })
  })

  test('nextInstallment: после отметки следующей становится очередная выплата', () => {
    expect(nextInstallment(parts, '2026-10-10')).toEqual({ date: '2026-10-25', amount: 2400000 })
    expect(nextInstallment(parts, '2026-10-25')).toEqual({ date: '2026-11-10', amount: 3600000 })
    // Пять выплат за месяц проходят по кругу и возвращаются к первой.
    const five = [1, 7, 14, 21, 28].map((day, i) => ({ day, amount: (i + 1) * 100 }))
    let current = upcomingInstallment(five, '2026-10-01')
    const seen = [current]
    for (let i = 0; i < 5; i++) seen.push((current = nextInstallment(five, current.date)))
    expect(seen.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-01'])
    expect(seen.map((p) => p.amount)).toEqual([100, 200, 300, 400, 500, 100])
  })

  test('число, которого нет в месяце, прижимается к его концу', () => {
    const endOfMonth = [{ day: 31, amount: 100 }]
    expect(upcomingInstallment(endOfMonth, '2027-02-01')).toEqual({ date: '2027-02-28', amount: 100 })
    expect(nextInstallment(endOfMonth, '2027-02-28')).toEqual({ date: '2027-03-31', amount: 100 })
    expect(installmentAt(endOfMonth, '2027-02-28')).toEqual({ day: 31, amount: 100 })
  })

  test('installmentAt и итог за месяц', () => {
    expect(installmentAt(parts, '2026-10-25')).toEqual({ day: 25, amount: 2400000 })
    expect(installmentAt(parts, '2026-10-24')).toBeUndefined()
    expect(installmentsTotal(parts)).toBe(6000000)
    const salary: Subscription = {
      ...synced,
      id: 'salary',
      direction: 'income',
      name: 'Зарплата',
      amount: 2400000,
      installments: parts,
      currency: 'RUB',
      period: 'month',
      nextDate: '2026-10-25',
      autoRenew: true,
      accountId: null,
      categoryId: null,
      remindDays: 3,
      note: '',
    }
    // В месячный итог идёт сумма всех выплат, а не только ближайшая.
    expect(monthlyTotals([salary])).toEqual([['RUB', 6000000]])
    expect(normalizeSubscription({ id: 's', direction: 'income' } as Subscription).installments).toBeNull()
  })
})
