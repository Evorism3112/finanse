// Проверка обновления базы первой версии: создаём её вручную в старом формате, затем открываем приложение.
// Запускается из run.mjs на чистом профиле браузера.
import { APP_URL, connect } from './driver.mjs'

const browser = await connect()
const run = (fn) => browser.evaluate(`(${fn.toString()})()`)

// Любая страница того же сайта: база привязана к адресу, а само приложение запускать пока нельзя.
await browser.navigate(`${APP_URL}icon.svg`)
await run(
  () =>
    new Promise((resolve, reject) => {
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
        const date = new Date().toISOString().slice(0, 10)
        t.objectStore('accounts').add({ ...meta, id: 'old-acc', name: 'Старая карта', currency: 'RUB', initialBalance: 100000 })
        t.objectStore('categories').add({ id: 'default-food', name: 'Еда (переименована)', kind: 'expense', createdAt: 0, updatedAt: 9, deletedAt: null })
        t.objectStore('transactions').add({ ...meta, id: 'old-tx', type: 'expense', accountId: 'old-acc', amount: 25000, toAccountId: null, toAmount: null, categoryId: 'default-food', date, note: 'старая' })
        t.oncomplete = () => {
          idb.close()
          resolve()
        }
        t.onerror = () => reject(t.error)
      }
    }),
)

await browser.navigate(APP_URL)
const out = await run(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const wait = async (what) => {
    const start = Date.now()
    while (!document.body.innerText.includes(what)) {
      if (Date.now() - start > 5000) throw new Error(`не дождались «${what}»:\n${document.body.innerText}`)
      await sleep(50)
    }
  }
  await wait('старая')
  const hasRow = document.body.innerText.includes('Еда (переименована)')
  const idb = await new Promise((res, rej) => {
    const o = indexedDB.open('finanse')
    o.onsuccess = () => res(o.result)
    o.onerror = () => rej(o.error)
  })
  const all = (store) => new Promise((res) => (idb.transaction(store).objectStore(store).getAll().onsuccess = (e) => res(e.target.result)))
  const accounts = await all('accounts')
  const categories = await all('categories')
  const result = { version: idb.version, stores: [...idb.objectStoreNames], account: accounts[0], categories: categories.map((c) => `${c.id}:${c.name}`), hasRow }
  idb.close()
  return JSON.stringify(result)
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
} else {
  console.log(`База обновлена с версии 1 до ${result.version / 10}, данные на месте.`)
}
browser.close()
process.exit(problems.length > 0 ? 1 : 0)
