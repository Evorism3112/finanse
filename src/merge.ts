import {
  normalizeAccount,
  normalizeCategory,
  normalizeSubscription,
  type Account,
  type Category,
  type Subscription,
  type Synced,
  type Transaction,
} from './db'

export interface Backup {
  app: 'finanse'
  version: 1
  exportedAt: number
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  subscriptions: Subscription[]
}

/** Записи из incoming, которых нет локально или которые изменены позже локальных. */
export function pickNewer<T extends Synced>(local: T[], incoming: T[]): T[] {
  const localById = new Map(local.map((r) => [r.id, r]))
  return incoming.filter((r) => {
    const mine = localById.get(r.id)
    return !mine || r.updatedAt > mine.updatedAt
  })
}

function isRecordList(value: unknown): value is Synced[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) => typeof r === 'object' && r !== null && typeof r.id === 'string' && typeof r.updatedAt === 'number',
    )
  )
}

/** Разбирает файл резервной копии. Бросает ошибку, если файл не подходит. */
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Файл не является JSON')
  }
  const b = data as Partial<Backup> | null
  if (typeof b !== 'object' || b === null || b.app !== 'finanse') {
    throw new Error('Это не файл резервной копии «Финансов»')
  }
  if (b.version !== 1) {
    throw new Error('Копия создана более новой версией приложения')
  }
  if (!isRecordList(b.accounts) || !isRecordList(b.categories) || !isRecordList(b.transactions)) {
    throw new Error('Файл повреждён')
  }
  // В копиях, сделанных до появления подписок, этого списка нет.
  const subscriptions = b.subscriptions ?? []
  if (!isRecordList(subscriptions)) {
    throw new Error('Файл повреждён')
  }
  // Копии старых версий дополняем полями, которых тогда не было.
  return {
    ...(b as Backup),
    accounts: b.accounts.map(normalizeAccount),
    categories: (b.categories as Category[]).map(normalizeCategory),
    subscriptions: (subscriptions as Subscription[]).map(normalizeSubscription),
  }
}
