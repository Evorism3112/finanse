// Проверка обновления базы первой версии: создаём её вручную в старом формате, затем открываем приложение.
// Запускается из run.mjs на чистом профиле браузера.
const PORT = process.env.E2E_BIDI_PORT ?? '9333'
const APP_URL = process.env.E2E_APP_URL ?? 'http://localhost:4199/'
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`)
let nextId = 1
const pending = new Map()
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.type === 'error') reject(new Error(`${msg.error}: ${msg.message}`))
    else resolve(msg.result)
  }
}
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('нет соединения')) })
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (fn) => {
  const r = await send('script.evaluate', { expression: `(${fn.toString()})()`, target: { context }, awaitPromise: true })
  if (r.type === 'exception') throw new Error(r.exceptionDetails.text)
  return r.result.value
}
await send('session.new', { capabilities: {} })
const context = (await send('browsingContext.getTree')).contexts[0].context
await send('browsingContext.navigate', { context, url: `${APP_URL}icon.svg`, wait: 'complete' })
await evaluate(() => new Promise((resolve, reject) => {
  // Dexie хранит версию 1 как 10.
  const open = indexedDB.open('finanse', 10)
  open.onupgradeneeded = () => {
    const idb = open.result
    idb.createObjectStore('accounts', { keyPath: 'id' })
    idb.createObjectStore('categories', { keyPath: 'id' })
    idb.createObjectStore('transactions', { keyPath: 'id' }).createIndex('date', 'date')
  }
  open.onerror = () => reject(open.error)
  open.onsuccess = () => {
    const idb = open.result
    const t = idb.transaction(['accounts', 'categories', 'transactions'], 'readwrite')
    const meta = { createdAt: 5, updatedAt: 5, deletedAt: null }
    t.objectStore('accounts').add({ ...meta, id: 'old-acc', name: 'Старая карта', currency: 'RUB', initialBalance: 100000 })
    t.objectStore('categories').add({ id: 'default-food', name: 'Еда (переименована)', kind: 'expense', createdAt: 0, updatedAt: 9, deletedAt: null })
    t.objectStore('transactions').add({ ...meta, id: 'old-tx', type: 'expense', accountId: 'old-acc', amount: 25000, toAccountId: null, toAmount: null, categoryId: 'default-food', date: new Date().toISOString().slice(0, 10), note: 'старая' })
    t.oncomplete = () => { idb.close(); resolve() }
    t.onerror = () => reject(t.error)
  }
}))
await send('browsingContext.navigate', { context, url: APP_URL, wait: 'complete' })
const out = await evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const wait = async (what) => { const s = Date.now(); while (!document.body.innerText.includes(what)) { if (Date.now() - s > 5000) throw new Error(`не дождались «${what}»:\n${document.body.innerText}`); await sleep(50) } }
  await wait('старая')
  const ops = document.body.innerText
  const idb = await new Promise((res, rej) => { const o = indexedDB.open('finanse'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error) })
  const all = (store) => new Promise((res) => { idb.transaction(store).objectStore(store).getAll().onsuccess = (e) => res(e.target.result) })
  const accounts = await all('accounts')
  const categories = await all('categories')
  const stores = [...idb.objectStoreNames]
  idb.close()
  return JSON.stringify({ version: idb.version, stores, account: accounts[0], categories: categories.map((c) => c.id + ':' + c.name), hasRow: ops.includes('Еда (переименована)') })
})
const result = JSON.parse(out)
const problems = []
if (!result.stores.includes('subscriptions')) problems.push('нет таблицы подписок')
if (result.account.kind !== 'regular') problems.push('старый счёт не стал обычным')
if (result.account.graceRemindDays !== 7 || result.account.graceDate !== null) problems.push('у счёта нет полей льготного периода')
if (result.account.initialBalance !== 100000) problems.push('начальный остаток изменился')
if (!result.categories.includes('default-food:Еда (переименована)')) problems.push('переименованная категория не сохранилась')
if (!result.categories.includes('default-subscriptions:Подписки')) problems.push('не добавлены новые стандартные категории')
if (!result.hasRow) problems.push('старая операция не показана')
if (problems.length > 0) {
  console.log('ОШИБКА обновления базы:', problems.join('; '))
  console.log(out)
  process.exitCode = 1
} else {
  console.log(`База обновлена с версии 1 до ${result.version / 10}, данные на месте.`)
}
ws.close()
