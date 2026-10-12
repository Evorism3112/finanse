import Dexie, { type Table } from 'dexie'
import { exportBackup } from './backup'
import { db } from './db'

/**
 * Автокопии: раз в день приложение само сохраняет полную копию данных в отдельную базу браузера.
 * Они спасают от ошибочной правки или неудачного обновления, но не от очистки данных сайта —
 * от неё защищает только файл.
 */
export interface Snapshot {
  /** Время создания, оно же ключ. */
  at: number
  /** День, за который сделана копия, ГГГГ-ММ-ДД. */
  day: string
  /** daily — ежедневная; manual — состояние перед восстановлением, чтобы его можно было отменить. */
  kind: 'daily' | 'manual'
  transactions: number
  /** Копия в том же формате, что и файл экспорта. */
  data: string
}

/** Сколько автокопий хранить. */
const KEEP = 14

const store = new Dexie('finanse-snapshots') as Dexie & { snapshots: Table<Snapshot, number> }
store.version(1).stores({ snapshots: 'at, day' })

async function save(day: string, kind: Snapshot['kind']): Promise<void> {
  const transactions = await db.transactions.count()
  await store.snapshots.put({ at: Date.now(), day, kind, transactions, data: await exportBackup() })
  const all = await store.snapshots.orderBy('at').primaryKeys()
  await store.snapshots.bulkDelete(all.slice(0, Math.max(0, all.length - KEEP)))
}

/** Сохраняет копию за сегодня, если её ещё нет и в базе есть что сохранять. */
export async function saveDailySnapshot(day: string): Promise<void> {
  const today = await store.snapshots.where('day').equals(day).toArray()
  if (today.some((s) => s.kind === 'daily')) return
  if ((await db.accounts.count()) === 0) return
  await save(day, 'daily')
}

/** Сохраняет текущее состояние вне очереди — перед восстановлением из копии. */
export function saveManualSnapshot(day: string): Promise<void> {
  return save(day, 'manual')
}

/** Автокопии, новые первыми. */
export function listSnapshots(): Promise<Snapshot[]> {
  return store.snapshots.orderBy('at').reverse().toArray()
}
