import type { Table } from 'dexie'
import { db, type Synced } from './db'
import { parseBackup, pickNewer, type Backup, type Records } from './merge'

const LAST_BACKUP_KEY = 'finanse:lastBackup'

/** Когда на этом устройстве последний раз сохраняли копию в файл; null — ещё ни разу. */
export function lastBackupAt(): number | null {
  try {
    const at = Number(localStorage.getItem(LAST_BACKUP_KEY))
    return at > 0 ? at : null
  } catch {
    return null
  }
}

export function markBackupDone(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()))
  } catch {
    // Хранилище недоступно — напоминание о копии просто останется.
  }
}

/** Полная копия базы, включая удалённые записи: пометки удаления нужны при слиянии. */
export async function exportBackup(): Promise<string> {
  const backup: Backup = {
    app: 'finanse',
    version: 1,
    exportedAt: Date.now(),
    accounts: await db.accounts.toArray(),
    categories: await db.categories.toArray(),
    transactions: await db.transactions.toArray(),
    subscriptions: await db.subscriptions.toArray(),
  }
  return JSON.stringify(backup)
}

async function mergeInto<T extends Synced>(table: Table<T, string>, incoming: T[]): Promise<number> {
  const newer = pickNewer(await table.toArray(), incoming)
  await table.bulkPut(newer)
  return newer.length
}

/** Сливает записи с локальной базой: побеждает более поздняя правка. Возвращает число обновлённых записей. */
export function mergeRecords(records: Records): Promise<number> {
  return db.transaction('rw', db.accounts, db.categories, db.transactions, db.subscriptions, async () => {
    const counts = await Promise.all([
      mergeInto(db.accounts, records.accounts),
      mergeInto(db.categories, records.categories),
      mergeInto(db.transactions, records.transactions),
      mergeInto(db.subscriptions, records.subscriptions),
    ])
    return counts.reduce((a, b) => a + b, 0)
  })
}

/** Импорт файла копии: то же слияние. */
export function importBackup(text: string): Promise<number> {
  return mergeRecords(parseBackup(text))
}

/**
 * Возвращает базу к состоянию из копии. Это не откат, а новая правка поверх текущих данных:
 * записи из копии получают свежее время изменения, а появившиеся после неё помечаются удалёнными.
 * Так возврат побеждает и при синхронизации — иначе другие устройства вернули бы всё обратно.
 */
export async function restoreBackup(text: string): Promise<void> {
  const backup = parseBackup(text)
  const now = Date.now()
  const restore = async <T extends Synced>(table: Table<T, string>, wanted: T[]) => {
    const kept = new Set(wanted.map((r) => r.id))
    const extra = (await table.toArray()).filter((r) => !kept.has(r.id))
    await table.bulkPut([
      ...wanted.map((r) => ({ ...r, updatedAt: now })),
      ...extra.map((r) => ({ ...r, deletedAt: r.deletedAt ?? now, updatedAt: now })),
    ])
  }
  await db.transaction('rw', db.accounts, db.categories, db.transactions, db.subscriptions, async () => {
    await restore(db.accounts, backup.accounts)
    await restore(db.categories, backup.categories)
    await restore(db.transactions, backup.transactions)
    await restore(db.subscriptions, backup.subscriptions)
  })
}
