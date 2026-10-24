import Dexie, { type Table } from 'dexie'

// Поля, общие для всех записей. Они нужны для будущей синхронизации:
// id генерируется на устройстве, удаление — только пометкой deletedAt.
export interface Synced {
  id: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type AccountKind = 'regular' | 'savings' | 'credit_card' | 'loan'

export interface Account extends Synced {
  name: string
  kind: AccountKind
  currency: string
  /** Начальный остаток в копейках. У кредитов и кредитных карт долг — отрицательный остаток. */
  initialBalance: number
  /** Кредитный лимит в копейках, только для кредитных карт. */
  creditLimit: number | null
  /** Годовая ставка в процентах, для сбережений и кредитов. */
  interestRate: number | null
  /** Цель накопления в копейках, только для сбережений. */
  targetAmount: number | null
  /** Начисленные проценты внутри долга по кредитной карте, в копейках: их нужно вернуть, но лимит они не занимают. */
  interestDebt: number
  /** Конец льготного периода кредитной карты: до этой даты долг гасят без процентов. ГГГГ-ММ-ДД. */
  graceDate: string | null
  /** Сколько нужно погасить до конца льготного периода, в копейках; null — весь долг. */
  graceAmount: number | null
  /** За сколько дней до конца льготного периода начинать напоминать. */
  graceRemindDays: number
  /** Размер регулярного взноса в копейках, для кредитов и кредитных карт. */
  paymentAmount: number | null
  /** Дата следующего взноса, ГГГГ-ММ-ДД. Взносы ежемесячные. */
  nextPaymentDate: string | null
  /** За сколько дней до взноса начинать напоминать. */
  paymentRemindDays: number
  /** Основной счёт: подставляется в новые операции и стоит первым в списках. */
  favorite: boolean
  /** День выписки кредитной карты (1–31): в этот день банк рассчитывает обязательный платёж; null — не задан. */
  statementDay: number | null
}

/** Дополняет счёт из старой базы или старой копии полями, которых тогда не было. */
export function normalizeAccount(a: Account): Account {
  return {
    ...a,
    kind: a.kind ?? 'regular',
    creditLimit: a.creditLimit ?? null,
    interestRate: a.interestRate ?? null,
    targetAmount: a.targetAmount ?? null,
    interestDebt: a.interestDebt ?? 0,
    graceDate: a.graceDate ?? null,
    graceAmount: a.graceAmount ?? null,
    graceRemindDays: a.graceRemindDays ?? 7,
    paymentAmount: a.paymentAmount ?? null,
    nextPaymentDate: a.nextPaymentDate ?? null,
    paymentRemindDays: a.paymentRemindDays ?? 3,
    favorite: a.favorite ?? false,
    statementDay: a.statementDay ?? null,
  }
}

export type CategoryKind = 'income' | 'expense'

export interface Category extends Synced {
  name: string
  kind: CategoryKind
  /** Лимит расходов на месяц в копейках, в основной валюте; null — без лимита. */
  budget: number | null
}

export function normalizeCategory(c: Category): Category {
  return { ...c, budget: c.budget ?? null }
}

export type TxType = 'income' | 'expense' | 'transfer'

export interface Transaction extends Synced {
  type: TxType
  accountId: string
  /** Сумма в копейках, всегда положительная. */
  amount: number
  /** Только для переводов. */
  toAccountId: string | null
  /** Сумма зачисления, если валюты счетов разные. */
  toAmount: number | null
  categoryId: string | null
  /** Дата в формате ГГГГ-ММ-ДД. */
  date: string
  note: string
}

export type Period = 'week' | 'month' | 'year'

/** Одна из нескольких выплат в месяц: число месяца и сумма в копейках. */
export interface Installment {
  day: number
  amount: number
}

export interface Subscription extends Synced {
  name: string
  /** Регулярный расход (подписка, аренда) или регулярный доход (зарплата). */
  direction: CategoryKind
  /** Стоимость одного периода в копейках. Если есть installments — сумма ближайшей выплаты. */
  amount: number
  /**
   * Выплаты, на которые делится месячная сумма (аванс и зарплата), по возрастанию числа месяца; null — одной суммой.
   * amount и nextDate при этом всегда описывают ближайшую выплату.
   */
  installments: Installment[] | null
  currency: string
  period: Period
  /** Дата следующего списания или окончания оплаченного срока, ГГГГ-ММ-ДД. */
  nextDate: string
  /** true — продлевается и списывается сама, false — в эту дату просто заканчивается. */
  autoRenew: boolean
  /** Счёт, с которого записывать расход при оплате. */
  accountId: string | null
  categoryId: string | null
  /** За сколько дней до даты начинать напоминать. */
  remindDays: number
  note: string
}

export function normalizeSubscription(s: Subscription): Subscription {
  return { ...s, direction: s.direction ?? 'expense', installments: s.installments ?? null }
}

export interface Data {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  subscriptions: Subscription[]
}

export const db = new Dexie('finanse') as Dexie & {
  accounts: Table<Account, string>
  categories: Table<Category, string>
  transactions: Table<Transaction, string>
  subscriptions: Table<Subscription, string>
}

db.version(1).stores({
  accounts: 'id',
  categories: 'id',
  transactions: 'id, date',
})

const DEFAULT_CATEGORIES: [id: string, name: string, kind: CategoryKind][] = [
  ['default-food', 'Продукты', 'expense'],
  ['default-transport', 'Транспорт', 'expense'],
  ['default-housing', 'Жильё', 'expense'],
  ['default-cafe', 'Кафе и рестораны', 'expense'],
  ['default-health', 'Здоровье', 'expense'],
  ['default-fun', 'Развлечения', 'expense'],
  ['default-subscriptions', 'Подписки', 'expense'],
  ['default-interest', 'Проценты по кредитам', 'expense'],
  ['default-other-expense', 'Прочее', 'expense'],
  ['default-salary', 'Зарплата', 'income'],
  ['default-other-income', 'Прочие доходы', 'income'],
]

// У стандартных категорий фиксированные id и нулевое время изменения:
// на разных устройствах они совпадут, а любая правка пользователя будет новее.
const defaultCategories = (): Category[] =>
  DEFAULT_CATEGORIES.map(([id, name, kind]) => ({ id, name, kind, budget: null, createdAt: 0, updatedAt: 0, deletedAt: null }))

db.on('populate', (tx) => {
  tx.table('categories').bulkAdd(defaultCategories())
})

// Версия 2: у счетов появился тип (сбережения, кредитная карта, кредит), добавились подписки
// и стандартные категории для процентов и подписок.
db.version(2)
  .stores({
    accounts: 'id',
    categories: 'id',
    transactions: 'id, date',
    subscriptions: 'id',
  })
  .upgrade(async (tx) => {
    await tx
      .table('accounts')
      .toCollection()
      .modify((a: Account) => {
        Object.assign(a, normalizeAccount(a))
      })
    const categories = tx.table('categories')
    for (const category of defaultCategories()) {
      if (!(await categories.get(category.id))) await categories.add(category)
    }
  })

// Версия 3: у кредитов и кредитных карт появились взносы и дата следующего платежа.
db.version(3).upgrade(async (tx) => {
  await tx
    .table('accounts')
    .toCollection()
    .modify((a: Account) => {
      Object.assign(a, normalizeAccount(a))
    })
})

// Версия 4: у кредитных карт появились проценты, которые входят в долг, но не занимают лимит.
db.version(4).upgrade(async (tx) => {
  await tx
    .table('accounts')
    .toCollection()
    .modify((a: Account) => {
      Object.assign(a, normalizeAccount(a))
    })
})

// Версия 5: льготный период у кредитных карт, лимиты у категорий, регулярные доходы.
db.version(5).upgrade(async (tx) => {
  await tx
    .table('accounts')
    .toCollection()
    .modify((a: Account) => {
      Object.assign(a, normalizeAccount(a))
    })
  await tx
    .table('categories')
    .toCollection()
    .modify((c: Category) => {
      Object.assign(c, normalizeCategory(c))
    })
  await tx
    .table('subscriptions')
    .toCollection()
    .modify((s: Subscription) => {
      Object.assign(s, normalizeSubscription(s))
    })
})

// Версия 6: регулярный доход можно разбить на несколько выплат в месяц.
db.version(6).upgrade(async (tx) => {
  await tx
    .table('subscriptions')
    .toCollection()
    .modify((s: Subscription) => {
      Object.assign(s, normalizeSubscription(s))
    })
})

// Версия 7: основной счёт.
db.version(7).upgrade(async (tx) => {
  await tx
    .table('accounts')
    .toCollection()
    .modify((a: Account) => {
      Object.assign(a, normalizeAccount(a))
    })
})

// Версия 8: день выписки кредитной карты.
db.version(8).upgrade(async (tx) => {
  await tx
    .table('accounts')
    .toCollection()
    .modify((a: Account) => {
      Object.assign(a, normalizeAccount(a))
    })
})

// crypto.randomUUID недоступен по http вне localhost, а getRandomValues работает везде.
function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function newRecord<T extends Synced>(data: Omit<T, keyof Synced>): T {
  const now = Date.now()
  return { ...data, id: uuid(), createdAt: now, updatedAt: now, deletedAt: null } as T
}

export function touched(): { updatedAt: number } {
  return { updatedAt: Date.now() }
}

export function deleted(): { updatedAt: number; deletedAt: number } {
  const now = Date.now()
  return { updatedAt: now, deletedAt: now }
}
