import type { Table } from 'dexie'
import { db, type Synced } from './db'
import { parseBackup, pickNewer, type Backup } from './merge'

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

/** Сливает копию с локальной базой: побеждает более поздняя правка. Возвращает число обновлённых записей. */
export async function importBackup(text: string): Promise<number> {
  const backup = parseBackup(text)
  return db.transaction('rw', db.accounts, db.categories, db.transactions, db.subscriptions, async () => {
    const counts = await Promise.all([
      mergeInto(db.accounts, backup.accounts),
      mergeInto(db.categories, backup.categories),
      mergeInto(db.transactions, backup.transactions),
      mergeInto(db.subscriptions, backup.subscriptions),
    ])
    return counts.reduce((a, b) => a + b, 0)
  })
}
