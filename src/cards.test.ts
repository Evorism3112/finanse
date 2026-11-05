import { describe, expect, test } from 'vitest'
import { cardDebt, cardTotals, initialBalanceForDebt } from './cards'
import type { Account, Subscription, Transaction } from './db'
import { paymentSchedule, scheduleTotals } from './schedule'
import { accountBalances } from './stats'

const synced = { createdAt: 1, updatedAt: 1, deletedAt: null }

const card = (id: string, fields: Partial<Account> = {}): Account => ({
  ...synced,
  id,
  name: id,
  kind: 'credit_card',
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
  favorite: false,
  statementDay: null,
  ...fields,
})

const sub = (id: string, fields: Partial<Subscription> = {}): Subscription => ({
  ...synced,
  id,
  name: id,
  direction: 'expense',
  amount: 29900,
  installments: null,
  currency: 'RUB',
  period: 'month',
  nextDate: '2026-11-10',
  autoRenew: true,
  accountId: null,
  categoryId: null,
  remindDays: 3,
  note: '',
  ...fields,
})

const tx = (fields: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction => ({
  ...synced,
  id: Math.random().toString(36),
  toAccountId: null,
  toAmount: null,
  categoryId: null,
  date: '2026-10-05',
  note: '',
  ...fields,
})

describe('долг кредитки', () => {
  test('cardDebt: свои деньги на карте долгом не считаются', () => {
    expect(cardDebt(-150000)).toBe(150000)
    expect(cardDebt(0)).toBe(0)
    expect(cardDebt(5000)).toBe(0)
  })

  test('новый долг ложится в начальный остаток, история взносов сохраняется', () => {
    const a = card('sber', { initialBalance: -1000000 })
    // Взнос 3 000 ₽ и подписка 299 ₽ с карты.
    const txs = [tx({ type: 'income', amount: 300000, accountId: 'sber' }), tx({ type: 'expense', amount: 29900, accountId: 'sber' })]
    const before = accountBalances([a], txs).get('sber')!
    expect(cardDebt(before)).toBe(729900)

    // В банке теперь долг 12 345,67 ₽.
    const updated = { ...a, initialBalance: initialBalanceForDebt(a, before, 1234567) }
    expect(cardDebt(accountBalances([updated], txs).get('sber')!)).toBe(1234567)

    // Долг погашен полностью.
    const zero = { ...a, initialBalance: initialBalanceForDebt(a, before, 0) }
    expect(accountBalances([zero], txs).get('sber')).toBe(0)
  })

  test('cardTotals: долг, лимит и доступно по валютам', () => {
    const cards = [
      card('a', { initialBalance: -2000000, creditLimit: 10000000 }),
      card('b', { initialBalance: -500000 }),
      card('c', { initialBalance: -100000, creditLimit: 300000, currency: 'USD' }),
    ]
    const balances = accountBalances(cards, [])
    expect(cardTotals(cards, balances)).toEqual([
      { currency: 'RUB', debt: 2500000, limit: 10000000, available: 8000000 },
      { currency: 'USD', debt: 100000, limit: 300000, available: 200000 },
    ])
  })
})

describe('календарь платежей', () => {
  const today = '2026-11-05'

  test('платежи, льготный период и подписки по дате; без долга — ничего по карте', () => {
    const cards = [
      card('sber', { initialBalance: -2000000, nextPaymentDate: '2026-11-07', paymentAmount: 300000, graceDate: '2026-11-25' }),
      card('alfa', { initialBalance: 0, nextPaymentDate: '2026-11-06', paymentAmount: 100000 }),
      card('tbank', { initialBalance: -500000, nextPaymentDate: '2026-12-20', paymentAmount: 50000 }),
    ]
    const subs = [sub('music', { nextDate: '2026-11-03' }), sub('cloud', { nextDate: '2026-11-20', amount: 14900 }), sub('far', { nextDate: '2027-01-01' })]
    const items = paymentSchedule(cards, accountBalances(cards, []), subs, today)
    expect(items.map((i) => [i.kind, i.id, i.date, i.amount, i.due])).toEqual([
      ['subscription', 'music', '2026-11-03', 29900, true],
      ['payment', 'sber:pay', '2026-11-07', 300000, true],
      ['subscription', 'cloud', '2026-11-20', 14900, false],
      ['grace', 'sber:grace', '2026-11-25', 2000000, false],
    ])
    // Льготный период — тот же долг, в сумму к оплате он не прибавляется.
    expect(scheduleTotals(items)).toEqual([['RUB', 344800]])
  })

  test('платёж без суммы виден в календаре, но в итог не входит', () => {
    const cards = [card('sber', { initialBalance: -100000, nextPaymentDate: '2026-11-10' })]
    const items = paymentSchedule(cards, accountBalances(cards, []), [], today)
    expect(items).toHaveLength(1)
    expect(scheduleTotals(items)).toEqual([])
  })
})
