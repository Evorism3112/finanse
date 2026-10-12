// Проверка синхронизации: два «устройства» (одно и то же окно с очищенными данными) и настоящий сервер.
// Запускается из run.mjs, который поднимает сервер и передаёт его адрес и ключ.
import { APP_URL, connect } from './driver.mjs'

const SERVER = process.env.E2E_SYNC_URL
const TOKEN = process.env.E2E_SYNC_TOKEN

const browser = await connect()

/** Ставит на страницу помощников для сценария; после каждого перехода их нужно ставить заново. */
const installHelpers = () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const text = () => document.body.innerText.replace(/[  ]/g, ' ')
  const waitFor = async (what, timeout = 8000) => {
    const start = Date.now()
    while (!text().toLowerCase().includes(what.toLowerCase())) {
      if (Date.now() - start > timeout) throw new Error(`не дождались «${what}». На экране:\n${text()}`)
      await sleep(50)
    }
  }
  const click = (selector, label) => {
    const el = [...document.querySelectorAll(selector)].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label || (b.lastChild?.textContent ?? '').trim() === label)
    if (!el) throw new Error(`нет элемента ${selector} «${label}»`)
    el.click()
  }
  const fill = (label, value) => {
    const holder = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label))
    if (!holder) throw new Error(`нет поля «${label}»`)
    const input = holder.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  window.__h = { sleep, text, waitFor, click, fill }
}

const open = async (url) => {
  await browser.navigate(url)
  await browser.evaluate(`(${installHelpers.toString()})()`)
}
const step = (fn, ...args) => browser.evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(', ')})`)

/** Обмен с сервером от имени ещё одного устройства — напрямую, без браузера. */
const asOtherDevice = async (body) => {
  const response = await fetch(`${SERVER}/api/sync`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`сервер ответил ${response.status}`)
  return response.json()
}

let failed = false
try {
  // Первое устройство: заводит счёт и подключается к серверу.
  await open(APP_URL)
  await step(async (server, token) => {
    const { waitFor, click, fill, sleep } = window.__h
    await waitFor('Сначала добавьте счёт')
    click('nav button', 'Счета')
    await waitFor('Счетов пока нет')
    click('button', 'Добавить счёт')
    await waitFor('Новый счёт')
    fill('Название', 'Общий счёт')
    fill('Начальный остаток', '500')
    click('button', 'Сохранить')
    await waitFor('Всего на счетах')

    click('nav button', 'Ещё')
    await waitFor('Синхронизация между устройствами')
    fill('Адрес сервера', server)
    // Ключ с опечаткой отвергает сервер, ключ не латиницей — само приложение.
    fill('Ключ доступа', 'wrong-key')
    click('button', 'Подключить')
    await waitFor('Неверный ключ доступа')
    fill('Ключ доступа', 'ключ кириллицей')
    click('button', 'Подключить')
    await sleep(300)
    await waitFor('Неверный ключ доступа')
    fill('Адрес сервера', 'http://localhost:1')
    fill('Ключ доступа', 'any-key')
    click('button', 'Подключить')
    await waitFor('Сервер недоступен')
    fill('Адрес сервера', server)
    fill('Ключ доступа', token)
    click('button', 'Подключить')
    await waitFor('Подключено к')
    await waitFor('Последняя синхронизация')
    await sleep(200)
  }, SERVER, TOKEN)

  const afterFirst = await asOtherDevice({ since: 0, changes: {} })
  const pushed = afterFirst.changes.accounts.find((a) => a.name === 'Общий счёт')
  if (!pushed || pushed.initialBalance !== 50000) throw new Error('счёт с первого устройства не дошёл до сервера')

  // Второе устройство: чистый браузер, после подключения получает счёт с сервера.
  await open(`${APP_URL}icon.svg`)
  await step(async () => {
    localStorage.clear()
    for (const name of ['finanse', 'finanse-snapshots']) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = resolve
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error(`база ${name} занята`))
      })
    }
  })
  await open(APP_URL)
  await step(async (server, token) => {
    const { waitFor, click, fill, text, sleep } = window.__h
    await waitFor('Сначала добавьте счёт')
    click('nav button', 'Ещё')
    await waitFor('Синхронизация между устройствами')
    fill('Адрес сервера', server)
    fill('Ключ доступа', token)
    click('button', 'Подключить')
    await waitFor('Последняя синхронизация')
    click('nav button', 'Счета')
    await waitFor('Общий счёт')
    if (!text().includes('500,00 ₽')) throw new Error('остаток счёта не пришёл с сервера:\n' + text())

    // Правка на втором устройстве уходит на сервер сама, без кнопки.
    ;[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Общий счёт')).click()
    await waitFor('Тип счёта')
    fill('Название', 'Общий счёт переименован')
    click('button', 'Сохранить')
    await waitFor('Общий счёт переименован')
    await sleep(4500)
  }, SERVER, TOKEN)

  const afterRename = await asOtherDevice({ since: 0, changes: {} })
  const renamed = afterRename.changes.accounts.find((a) => a.id === pushed.id)
  if (renamed?.name !== 'Общий счёт переименован') throw new Error(`правка не ушла на сервер сама: ${renamed?.name}`)

  // Импорт копии на уже подключённом устройстве: у её записей старое время изменения,
  // но на сервер они всё равно должны попасть.
  await step(async () => {
    const { waitFor, click, sleep } = window.__h
    click('nav button', 'Ещё')
    await waitFor('Импорт из файла')
    const old = { createdAt: 1000, updatedAt: 1000, deletedAt: null }
    const backup = {
      app: 'finanse',
      version: 1,
      exportedAt: 2000,
      accounts: [{ ...old, id: 'imported-account', name: 'Из старой копии', kind: 'regular', currency: 'RUB', initialBalance: 77700 }],
      categories: [],
      transactions: [],
      subscriptions: [],
    }
    const input = document.querySelector('input[type="file"]')
    const files = new DataTransfer()
    files.items.add(new File([JSON.stringify(backup)], 'finanse-old.json', { type: 'application/json' }))
    input.files = files.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor('Обновлено записей: 1')
    await sleep(1500)
  })
  const afterImport = await asOtherDevice({ since: 0, changes: {} })
  if (!afterImport.changes.accounts.some((a) => a.id === 'imported-account')) throw new Error('счёт из импортированной копии не попал на сервер')

  // Третье устройство меняет тот же счёт позже — второе получает правку при обмене.
  await asOtherDevice({ since: afterImport.rev, changes: { accounts: [{ ...renamed, name: 'Изменено с телефона', updatedAt: Date.now() + 1000 }] } })
  await step(async () => {
    const { waitFor, click } = window.__h
    click('nav button', 'Ещё')
    await waitFor('Подключено к')
    click('button', 'Синхронизировать сейчас')
    click('nav button', 'Счета')
    await waitFor('Изменено с телефона')

    // Отключение возвращает форму подключения, данные остаются.
    click('nav button', 'Ещё')
    await waitFor('Подключено к')
    click('button', 'Отключить')
    await waitFor('Точно отключить?')
    click('button', 'Точно отключить?')
    await waitFor('Адрес сервера')
    click('nav button', 'Счета')
    await waitFor('Изменено с телефона')
  })

  console.log('Синхронизация работает: отправка, получение на чистом устройстве, правки в обе стороны, импорт копии.')
} catch (error) {
  console.log('ОШИБКА синхронизации:', error.message)
  failed = true
}
browser.close()
process.exit(failed ? 1 : 0)
