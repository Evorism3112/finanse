// Ядро синхронизации: хранит записи всех устройств в SQLite и сводит их по правилу «побеждает последняя правка».
import { DatabaseSync } from 'node:sqlite'

export const TABLES = ['accounts', 'categories', 'transactions', 'subscriptions']

export function openDatabase(path) {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      tbl        TEXT    NOT NULL,
      id         TEXT    NOT NULL,
      updated_at INTEGER NOT NULL,
      -- Порядковый номер изменения на сервере: по нему устройство узнаёт, что для него нового.
      rev        INTEGER NOT NULL,
      data       TEXT    NOT NULL,
      PRIMARY KEY (tbl, id)
    );
    CREATE INDEX IF NOT EXISTS records_rev ON records (rev);
  `)
  return db
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && typeof value.id === 'string' && Number.isFinite(value.updatedAt)
}

/**
 * Один обмен с устройством. Оно присылает свои изменения и номер since, до которого уже всё получило;
 * в ответ получает чужие изменения новее since и новый номер.
 */
export function sync(db, { since = 0, changes = {} } = {}) {
  if (!Number.isInteger(since) || since < 0) throw new SyncError('since должен быть неотрицательным целым')
  if (typeof changes !== 'object' || changes === null) throw new SyncError('changes должен быть объектом')

  const current = db.prepare('SELECT updated_at FROM records WHERE tbl = ? AND id = ?')
  const upsert = db.prepare(`
    INSERT INTO records (tbl, id, updated_at, rev, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (tbl, id) DO UPDATE SET updated_at = excluded.updated_at, rev = excluded.rev, data = excluded.data
  `)

  db.exec('BEGIN IMMEDIATE')
  try {
    let rev = db.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM records').get().rev
    const accepted = new Set()

    for (const tbl of TABLES) {
      const incoming = changes[tbl] ?? []
      if (!Array.isArray(incoming)) throw new SyncError(`changes.${tbl} должен быть списком`)
      for (const record of incoming) {
        if (!isRecord(record)) throw new SyncError(`в ${tbl} есть запись без id или updatedAt`)
        const existing = current.get(tbl, record.id)
        // Более старая правка проигрывает: устройство получит победившую версию в этом же ответе.
        if (existing && existing.updated_at >= record.updatedAt) continue
        rev += 1
        upsert.run(tbl, record.id, record.updatedAt, rev, JSON.stringify(record))
        accepted.add(`${tbl}:${record.id}`)
      }
    }

    const out = Object.fromEntries(TABLES.map((tbl) => [tbl, []]))
    for (const row of db.prepare('SELECT tbl, id, data FROM records WHERE rev > ? ORDER BY rev').all(since)) {
      // То, что устройство только что прислало само, обратно не отправляем.
      if (!accepted.has(`${row.tbl}:${row.id}`)) out[row.tbl].push(JSON.parse(row.data))
    }

    db.exec('COMMIT')
    return { rev, changes: out }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Ошибка в запросе устройства — отвечаем 400, а не 500. */
export class SyncError extends Error {}
