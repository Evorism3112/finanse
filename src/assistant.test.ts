import { describe, expect, test } from 'vitest'
import { answer, parseDay, parseMoney, parseOperation, parseRange, sameRoot } from './assistant'
import type { Account, Category, Subscription, Transaction } from './db'
import { dailyBudget, payoff, recurringCandidates, unusualSpending } from './insights'
import { accountBalances } from './stats'

const TODAY = '2026-10-25'
/** Суммы форматируются с неразрывными пробелами — для сравнения заменяем их обычными. */
const plain = (lines: string[]) => lines.join(' ').replace(/[\u00a0\u202f]/g, ' ')
let n = 0
const base = () => ({ id: `id-${++n}`, createdAt: n, updatedAt: n, deletedAt: null })

const account = (fields: Partial<Account>): Account => ({
  ...base(),
  name: 'Счёт',
  kind: 'regular',
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

const category = (id: string, name: string, kind: Category['kind'] = 'expense'): Category => ({ id, name, kind, budget: null, createdAt: 0, updatedAt: 0, deletedAt: null })

const tx = (fields: Partial<Transaction>): Transaction => ({
  ...base(),
  type: 'expense',
  amount: 0,
  accountId: '',
  toAccountId: null,
  toAmount: null,
  categoryId: null,
  date: TODAY,
  note: '',
  ...fields,
})

const card = account({ name: 'Карта', initialBalance: 5_000_000, favorite: true })
const alfa = account({ name: 'Альфа', initialBalance: 1_000_000 })
const credit = account({ name: 'Кредитка', kind: 'credit_card', initialBalance: -2_000_000, creditLimit: 10_000_000 })
const savings = account({ name: 'Накопления', kind: 'savings', initialBalance: 15_000_000 })
const loan = account({ name: 'Автокредит', kind: 'loan', initialBalance: -12_000_000, interestRate: 12, paymentAmount: 1_000_000, nextPaymentDate: '2026-10-28' })
const categories = [
  category('default-food', 'Продукты'),
  category('default-cafe', 'Кафе и рестораны'),
  category('default-transport', 'Транспорт'),
  category('default-salary', 'Зарплата', 'income'),
  category('gifts', 'Подарки'),
]
const transactions = [
  tx({ amount: 25_000, accountId: card.id, categoryId: 'default-cafe', note: 'Кофе', date: '2026-10-20' }),
  tx({ amount: 300_000, accountId: card.id, categoryId: 'default-food', date: '2026-10-21' }),
  tx({ amount: 150_000, accountId: card.id, categoryId: 'gifts', note: 'Цветы маме', date: '2026-10-22' }),
  tx({ amount: 200_000, accountId: card.id, categoryId: 'default-food', date: '2026-09-21' }),
  tx({ type: 'income', amount: 9_000_000, accountId: card.id, categoryId: 'default-salary', date: '2026-10-05' }),
]
const subscriptions: Subscription[] = [
  { ...base(), name: 'Зарплата', direction: 'income', amount: 9_000_000, installments: null, currency: 'RUB', period: 'month', nextDate: '2026-11-05', autoRenew: true, accountId: card.id, categoryId: 'default-salary', remindDays: 0, note: '' },
  { ...base(), name: 'Музыка', direction: 'expense', amount: 29_900, installments: null, currency: 'RUB', period: 'month', nextDate: '2026-10-27', autoRenew: true, accountId: card.id, categoryId: null, remindDays: 3, note: '' },
]
const ctx = { accounts: [card, alfa, credit, savings, loan], categories, transactions, subscriptions, today: TODAY }

describe('помощник: разбор фраз', () => {
  test('слова в разных формах', () => {
    expect(sameRoot('альфы', 'альфа')).toBe(true)
    expect(sameRoot('кредитки', 'кредитка')).toBe(true)
    expect(sameRoot('кофе', 'кафе')).toBe(false)
    expect(sameRoot('так', 'такси')).toBe(false)
  })

  test('суммы', () => {
    expect(parseMoney('кофе 250')).toBe(25_000)
    expect(parseMoney('продукты 1 240,50')).toBe(124_050)
    expect(parseMoney('ремонт 3к')).toBe(300_000)
    expect(parseMoney('премия 15 тыс')).toBe(1_500_000)
    expect(parseMoney('такси 12.10 600')).toBe(60_000)
    expect(parseMoney('просто текст')).toBeNull()
  })

  test('даты', () => {
    expect(parseDay('кофе 250', TODAY)).toBe(TODAY)
    expect(parseDay('вчера такси 600', TODAY)).toBe('2026-10-24')
    expect(parseDay('позавчера 600', TODAY)).toBe('2026-10-23')
    expect(parseDay('12.10 продукты 500', TODAY)).toBe('2026-10-12')
    expect(parseDay('28.12 подарки 500', TODAY)).toBe('2025-12-28')
  })

  test('периоды', () => {
    expect(parseRange('сколько потратил', TODAY)).toMatchObject({ from: '2026-10-01', to: TODAY, label: 'в октябре' })
    expect(parseRange('расходы за прошлый месяц', TODAY)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(parseRange('сколько ушло в сентябре', TODAY)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(parseRange('доходы за 3 месяца', TODAY)).toMatchObject({ from: '2026-08-01', to: TODAY })
    expect(parseRange('траты в декабре', TODAY)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
  })

  test('расход с категорией по словарю и комментарием', () => {
    expect(parseOperation('кофе 250', ctx)).toMatchObject({ type: 'expense', amount: 25_000, accountId: card.id, categoryId: 'default-cafe', note: 'Кофе' })
  })

  test('счёт и дата из фразы', () => {
    expect(parseOperation('вчера такси 600 с кредитки', ctx)).toMatchObject({
      type: 'expense',
      accountId: credit.id,
      categoryId: 'default-transport',
      date: '2026-10-24',
    })
    // Название счёта не подменяет категорию.
    expect(parseOperation('кредитки 500 продукты', { ...ctx, categories: [...categories, { ...categories[0], id: 'default-interest', name: 'Проценты по кредитам' }] })).toMatchObject({
      accountId: credit.id,
      categoryId: 'default-food',
    })
  })

  test('фраза из голосового ввода: с заглавной буквы и со словом «рублей»', () => {
    expect(parseOperation('Такси 600 рублей с кредитки', ctx)).toMatchObject({ amount: 60_000, accountId: credit.id, categoryId: 'default-transport', note: 'Такси' })
    expect(parseOperation('Зарплата 90 тысяч', ctx)).toMatchObject({ type: 'income', amount: 9_000_000 })
  })

  test('категория по прошлым операциям пользователя', () => {
    expect(parseOperation('цветы 2000', ctx)).toMatchObject({ categoryId: 'gifts' })
  })

  test('доход', () => {
    expect(parseOperation('зарплата 90000', ctx)).toMatchObject({ type: 'income', categoryId: 'default-salary', amount: 9_000_000 })
    expect(parseOperation('получил 5000 за халтуру', ctx)).toMatchObject({ type: 'income' })
  })

  test('переводы', () => {
    expect(parseOperation('перевод 5000 с альфы на накопления', ctx)).toMatchObject({ type: 'transfer', accountId: alfa.id, toAccountId: savings.id })
    expect(parseOperation('погасил кредитку 10000', ctx)).toMatchObject({ type: 'transfer', accountId: card.id, toAccountId: credit.id, categoryId: null })
  })
})

describe('помощник: ответы', () => {
  test('«что ты можешь» показывает все команды', () => {
    const reply = answer('Что ты можешь?', ctx)
    expect(reply.sections?.map((s) => s.title)).toEqual(['Записать операцию', 'Траты и доходы', 'Планирование', 'Счета и советы'])
    expect(reply.sections?.flatMap((s) => s.items)).toContain('когда закрою автокредит')
  })

  test('фраза с суммой — черновик операции, а вопрос с числом — нет', () => {
    expect(answer('кофе 250', ctx).draft?.categoryId).toBe('default-cafe')
    expect(answer('доходы за 3 месяца', ctx).draft).toBeUndefined()
  })

  test('траты по категории за период', () => {
    expect(plain(answer('сколько потратил на продукты', ctx).text)).toMatch(/Продукты» в октябре: 3 000,00 ₽ — 1 операция/)
    expect(plain(answer('сколько ушло на продукты в сентябре', ctx).text)).toMatch(/в сентябре: 2 000,00 ₽/)
  })

  test('доходы', () => {
    expect(plain(answer('сколько заработал', ctx).text)).toMatch(/Доходы в октябре: 90 000,00 ₽/)
  })

  test('погашение кредита и досрочные взносы', () => {
    const reply = answer('что если вносить на 5000 больше', ctx)
    expect(plain(reply.text)).toMatch(/Автокредит: долг 120 000,00 ₽/)
    expect(reply.rows?.[0].hint).toMatch(/быстрее на \d+ мес/)
  })

  test('непонятное', () => {
    expect(answer('расскажи анекдот', ctx).chips).toEqual(['что ты можешь'])
  })
})

describe('умные расчёты', () => {
  test('сколько можно тратить в день до зарплаты', () => {
    const balances = accountBalances(ctx.accounts, transactions)
    const b = dailyBudget(ctx.accounts, balances, subscriptions, TODAY)
    // Обычные счета: Карта (50 000 − 6 750 расходов + 90 000) и Альфа (10 000).
    expect(b.available).toBe(14_325_000)
    expect(b.until).toBe('2026-11-05')
    expect(b.days).toBe(11)
    expect(b.obligations.map((o) => o.title)).toEqual(['Музыка', 'Автокредит: взнос'])
    expect(b.free).toBe(14_325_000 - 29_900 - 1_000_000)
    expect(b.perDay).toBe(Math.floor(b.free / 11))
  })

  test('погашение долга', () => {
    expect(payoff(12_000_000, 0, 1_000_000)).toEqual({ months: 12, interest: 0 })
    const withRate = payoff(12_000_000, 12, 1_000_000)
    expect(withRate.months).toBe(13)
    expect(withRate.interest).toBeGreaterThan(0)
    expect(payoff(12_000_000, 120, 100_000).months).toBeNull()
  })

  test('необычные траты', () => {
    const history = ['2026-07-10', '2026-08-10', '2026-09-10'].map((date) => tx({ amount: 100_000, accountId: card.id, categoryId: 'default-transport', date }))
    const now = tx({ amount: 400_000, accountId: card.id, categoryId: 'default-transport', date: '2026-10-10' })
    expect(unusualSpending([card], [...history, now], TODAY)).toEqual([{ categoryId: 'default-transport', spent: 400_000, usual: 100_000 }])
  })

  test('похожие на подписку списания', () => {
    const monthly = ['2026-08-03', '2026-09-03', '2026-10-03'].map((date) => tx({ amount: 39_900, accountId: card.id, note: 'Яндекс Плюс', date }))
    expect(recurringCandidates(monthly, [], TODAY)).toMatchObject([{ note: 'Яндекс Плюс', amount: 39_900 }])
    expect(recurringCandidates(monthly, [{ ...subscriptions[1], name: 'Яндекс Плюс' }], TODAY)).toEqual([])
  })
})
