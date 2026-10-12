import { describe, expect, test } from 'vitest'
import { openDatabase, sync, SyncError } from './sync.mjs'

const record = (id, updatedAt, extra = {}) => ({ id, updatedAt, createdAt: 1, deletedAt: null, ...extra })
const ids = (list) => list.map((r) => r.id)

describe('сервер синхронизации', () => {
  test('два устройства обмениваются записями', () => {
    const db = openDatabase(':memory:')
    // Телефон отправил две операции.
    const phone = sync(db, { since: 0, changes: { transactions: [record('t1', 10), record('t2', 11)] } })
    expect(phone.rev).toBe(2)
    expect(phone.changes.transactions).toEqual([])

    // Компьютер впервые подключился со своим счётом и получил операции телефона.
    const laptop = sync(db, { since: 0, changes: { accounts: [record('a1', 5, { name: 'Карта' })] } })
    expect(laptop.rev).toBe(3)
    expect(ids(laptop.changes.transactions)).toEqual(['t1', 't2'])
    expect(laptop.changes.accounts).toEqual([])

    // Телефон при следующем обмене получает только новое для себя.
    const phoneAgain = sync(db, { since: phone.rev, changes: {} })
    expect(phoneAgain.rev).toBe(3)
    expect(phoneAgain.changes.accounts).toEqual([record('a1', 5, { name: 'Карта' })])
    expect(phoneAgain.changes.transactions).toEqual([])

    // Когда нового нет, ответ пустой и номер не меняется.
    expect(sync(db, { since: 3, changes: {} })).toEqual({
      rev: 3,
      changes: { accounts: [], categories: [], transactions: [], subscriptions: [] },
    })
  })

  test('побеждает более поздняя правка, проигравший получает её обратно', () => {
    const db = openDatabase(':memory:')
    sync(db, { since: 0, changes: { accounts: [record('a1', 100, { name: 'Новое имя' })] } })

    const stale = sync(db, { since: 0, changes: { accounts: [record('a1', 50, { name: 'Старое имя' })] } })
    expect(stale.rev).toBe(1)
    expect(stale.changes.accounts).toEqual([record('a1', 100, { name: 'Новое имя' })])

    const newer = sync(db, { since: 1, changes: { accounts: [record('a1', 200, { name: 'Ещё новее' })] } })
    expect(newer.rev).toBe(2)
    expect(sync(db, { since: 1, changes: {} }).changes.accounts).toEqual([record('a1', 200, { name: 'Ещё новее' })])
  })

  test('удаление передаётся как запись с пометкой', () => {
    const db = openDatabase(':memory:')
    sync(db, { since: 0, changes: { transactions: [record('t1', 10)] } })
    sync(db, { since: 1, changes: { transactions: [record('t1', 20, { deletedAt: 20 })] } })
    expect(sync(db, { since: 1, changes: {} }).changes.transactions).toEqual([record('t1', 20, { deletedAt: 20 })])
  })

  test('одинаковые id в разных таблицах не мешают друг другу', () => {
    const db = openDatabase(':memory:')
    sync(db, { since: 0, changes: { accounts: [record('x', 1)], categories: [record('x', 2)] } })
    const all = sync(db, { since: 0, changes: {} }).changes
    expect(all.accounts).toEqual([record('x', 1)])
    expect(all.categories).toEqual([record('x', 2)])
  })

  test('некорректный запрос отклоняется и ничего не сохраняет', () => {
    const db = openDatabase(':memory:')
    expect(() => sync(db, { since: -1 })).toThrow(SyncError)
    expect(() => sync(db, { since: 0, changes: { accounts: 'нет' } })).toThrow(SyncError)
    // Первая запись годная, вторая нет — откатывается весь запрос.
    expect(() => sync(db, { since: 0, changes: { accounts: [record('a1', 1), { id: 5 }] } })).toThrow(SyncError)
    expect(sync(db, { since: 0, changes: {} }).rev).toBe(0)
    // Незнакомые таблицы молча пропускаются.
    expect(sync(db, { since: 0, changes: { secrets: [record('s', 1)] } }).rev).toBe(0)
  })
})
