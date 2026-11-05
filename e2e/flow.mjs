// Сквозной сценарий: проходит по всему приложению в настоящем браузере.
// Запускается из run.mjs; первый аргумент — папка для скриншотов (необязательно).
import { writeFileSync } from 'node:fs'
import { APP_URL, connect } from './driver.mjs'

const browser = await connect()
await browser.navigate(APP_URL)

const flow = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const text = () => document.body.innerText
  const norm = (s) => s.replace(/[\u00a0\u202f]/g, ' ')
  const waitFor = async (what, timeout = 5000) => {
    const start = Date.now()
    while (!norm(text()).toLowerCase().includes(what.toLowerCase())) {
      if (Date.now() - start > timeout) throw new Error(`не дождались «${what}». На экране:\n${norm(text())}`)
      await sleep(50)
    }
  }
  const click = (selector, label) => {
    const el = [...document.querySelectorAll(selector)].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label || (b.lastChild?.textContent ?? '').trim() === label)
    if (!el) throw new Error(`нет элемента ${selector} «${label}»`)
    el.click()
  }
  const field = (label) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label))
    if (!l) throw new Error(`нет поля «${label}»`)
    return l.querySelector('input, select, button.select')
  }
  const fill = (label, value) => {
    const el = field(label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const choose = async (label, optionText) => {
    field(label).click()
    await sleep(80)
    const option = [...document.querySelectorAll('.sheet [role="option"]')].find((o) => o.querySelector('.option-label').textContent.trim() === optionText)
    if (!option) throw new Error(`нет варианта «${optionText}» в «${label}»:\n` + document.querySelector('.sheet')?.innerText)
    option.click()
    await sleep(80)
    if (document.querySelector('.sheet')) throw new Error('список не закрылся после выбора')
  }
  // Даты вводятся как ДД.ММ.ГГ.
  const inDays = (n) => {
    const d = new Date(Date.now() + n * 86400000)
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`
  }
  const submitModal = () => document.querySelector('.modal button[type="submit"]').click()
  const row = (name) => {
    const li = [...document.querySelectorAll('main .list li')].find((x) => x.textContent.includes(name))
    if (!li) throw new Error(`нет строки «${name}»:\n${norm(text())}`)
    return li
  }
  const rowText = (name) => norm(row(name).innerText).replace(/\s*\n\s*/g, ' ')
  const rowChip = (name, label) => {
    const chip = [...row(name).querySelectorAll('.chip')].find((c) => c.textContent.trim() === label)
    if (!chip) throw new Error(`нет кнопки «${label}» в строке «${name}»`)
    chip.click()
  }
  const steps = []
  const snap = (name) => steps.push(`--- ${name} ---\n${norm(text())}`)

  await waitFor('Добро пожаловать')
  for (const gone of ['Операции', 'Аналитика', 'Помощник', 'Счета']) {
    if ([...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === gone)) throw new Error(`в меню остался раздел «${gone}»`)
  }
  snap('пустой старт')

  // Кредитка: лимит, долг и обязательный платёж.
  click('button', 'Добавить кредитку')
  await waitFor('Кредиток пока нет')
  click('button', 'Добавить кредитку')
  await waitFor('Новая кредитка')
  fill('Название', 'Сбер')
  fill('Кредитный лимит', '100000')
  fill('Долг сейчас', 'abc')
  submitModal()
  await waitFor('Долг — это число')
  fill('Долг сейчас', '25000')
  fill('Обязательный платёж', '3000')
  fill('Дата следующего платежа', inDays(2))
  submitModal()
  await waitFor('Сбер')
  if (!rowText('Сбер').includes('доступно 75 000,00 ₽ из 100 000,00 ₽')) throw new Error('лимит карты:\n' + rowText('Сбер'))
  if (!rowText('Сбер').includes('платёж через 2 дн.') || !rowText('Сбер').includes('3 000,00 ₽')) throw new Error('платёж карты:\n' + rowText('Сбер'))
  if (!rowText('Сбер').includes('−25 000,00 ₽')) throw new Error('долг карты:\n' + rowText('Сбер'))

  click('header button', 'Добавить кредитку')
  await waitFor('Новая кредитка')
  fill('Название', 'Альфа')
  fill('Кредитный лимит', '50000')
  submitModal()
  await waitFor('нет долга')
  if (!norm(text()).includes('Долг по кредиткам')) throw new Error('нет итога по картам')
  snap('кредитки')

  // Долг обновляется прямо из строки карты: покупки вести не нужно.
  rowChip('Альфа', 'Обновить долг')
  await waitFor('Долг: Альфа')
  fill('Долг сейчас', '12345,67')
  submitModal()
  await sleep(300)
  if (!rowText('Альфа').includes('−12 345,67 ₽') || !rowText('Альфа').includes('доступно 37 654,33 ₽')) throw new Error('новый долг:\n' + rowText('Альфа'))
  await waitFor('37 345,67')

  // Подписка, которая списывается с кредитки.
  click('nav button', 'Подписки')
  await waitFor('Подписок пока нет')
  click('header button', 'Добавить подписку')
  await waitFor('Новая подписка')
  fill('Название', 'Музыка')
  fill('Стоимость', '299')
  fill('Следующее списание', inDays(1))
  await choose('Списывается с кредитки', 'Альфа')
  submitModal()
  await waitFor('Музыка')
  if (!rowText('Музыка').includes('списание завтра') || !rowText('Музыка').includes('Альфа')) throw new Error('строка подписки:\n' + rowText('Музыка'))

  click('header button', 'Добавить подписку')
  await waitFor('Новая подписка')
  fill('Название', 'Облако')
  fill('Стоимость', '1200')
  await choose('Периодичность', 'Каждый год')
  await waitFor('В пересчёте на месяц: 100,00 ₽')
  fill('Следующее списание', inDays(20))
  submitModal()
  await waitFor('Облако')
  await waitFor('Подписки в месяц')
  if (!norm(text()).includes('399,00 ₽')) throw new Error('итог подписок в месяц должен быть 299 + 100:\n' + norm(text()))
  snap('подписки')

  // «Оплачено» переносит срок и добавляет сумму к долгу карты.
  rowChip('Музыка', 'Оплачено')
  await waitFor('Оплачено: Музыка')
  await waitFor('Сумма добавится к долгу карты')
  submitModal()
  await sleep(300)
  if (rowText('Музыка').includes('завтра')) throw new Error('срок подписки не перенёсся:\n' + rowText('Музыка'))
  click('nav button', 'Кредитки')
  await waitFor('Альфа')
  if (!rowText('Альфа').includes('−12 644,67 ₽')) throw new Error('подписка не добавилась к долгу:\n' + rowText('Альфа'))

  // Сводка: календарь платежей и итоги.
  click('nav button', 'Сводка')
  await waitFor('Ближайшие платежи')
  await waitFor('обязательный платёж · через 2 дн.')
  await waitFor('Облако')
  if (!norm(text()).includes('37 644,67 ₽')) throw new Error('общий долг на сводке:\n' + norm(text()))
  snap('сводка')

  // Взнос с главной: долг уменьшается, срок переносится.
  rowChip('Сбер', 'Внести')
  await waitFor('Взнос: Сбер')
  if (field('Сумма взноса').value !== '3000,00') throw new Error('сумма взноса по умолчанию: ' + field('Сумма взноса').value)
  await waitFor('Долг после взноса: 22 000,00 ₽')
  fill('Дата следующего платежа', inDays(-3))
  submitModal()
  await waitFor('должен быть позже')
  fill('Дата следующего платежа', inDays(30))
  submitModal()
  await sleep(300)
  click('nav button', 'Кредитки')
  await waitFor('Сбер')
  if (!rowText('Сбер').includes('−22 000,00 ₽') || !rowText('Сбер').includes('платёж через 30 дн.')) throw new Error('после взноса:\n' + rowText('Сбер'))

  // Льготный период и полное погашение.
  ;[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Сбер')).click()
  await waitFor('Кредитка')
  fill('Льготный период до', inDays(6))
  await waitFor('Погасить до этой даты')
  fill('Погасить до этой даты', '10000')
  submitModal()
  await waitFor('через 6 дн. · погасить 10 000,00 ₽')
  click('nav button', 'Сводка')
  await waitFor('конец льготного периода · через 6 дн.')
  rowChip('Сбер', 'Внести')
  await waitFor('Взнос: Сбер')
  click('button', 'Погасить полностью')
  await waitFor('погашен полностью')
  submitModal()
  await sleep(300)
  click('nav button', 'Кредитки')
  await waitFor('Сбер')
  if (!rowText('Сбер').includes('нет долга') || rowText('Сбер').includes('платёж через') || rowText('Сбер').includes('без % до')) throw new Error('после полного погашения:\n' + rowText('Сбер'))
  snap('погашено')

  // Резервная копия: напоминание на сводке исчезает после экспорта.
  click('nav button', 'Сводка')
  await waitFor('Резервная копия ещё не сохранялась')
  click('nav button', 'Настройки')
  await waitFor('Копия с этого устройства ещё не сохранялась')
  for (const gone of ['Категории', 'Импорт выписки']) if (text().includes(gone)) throw new Error(`в настройках остался пункт «${gone}»`)
  click('button', 'Экспорт в файл')
  await waitFor('Последняя копия с этого устройства')
  click('nav button', 'Сводка')
  await sleep(200)
  if (text().includes('Резервная копия ещё не сохранялась')) throw new Error('напоминание о копии не исчезло')

  // Автокопия снята сразу после первой карты: возврат к ней убирает всё остальное, а отмена возвращает.
  click('nav button', 'Настройки')
  await waitFor('Автокопии на этом устройстве')
  click('.snapshots button', 'Вернуть')
  await waitFor('Заменить данные?')
  click('.snapshots button', 'Заменить данные?')
  await waitFor('Данные возвращены к копии')
  click('nav button', 'Кредитки')
  await waitFor('Сбер')
  if (text().includes('Альфа') || !rowText('Сбер').includes('−25 000,00 ₽')) throw new Error('восстановление не вернуло старое состояние:\n' + norm(text()))
  click('nav button', 'Настройки')
  await waitFor('перед восстановлением')
  click('.snapshots button', 'Вернуть')
  await waitFor('Заменить данные?')
  click('.snapshots button', 'Заменить данные?')
  await sleep(500)
  click('nav button', 'Кредитки')
  await waitFor('Альфа')
  if (!rowText('Сбер').includes('нет долга')) throw new Error('отмена восстановления не вернула данные:\n' + norm(text()))

  // Удаление карты подтверждается вторым нажатием и отвязывает подписку.
  ;[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Альфа')).click()
  await waitFor('Кредитка')
  click('button', 'Удалить')
  await waitFor('Точно удалить?')
  click('button', 'Точно удалить?')
  await sleep(300)
  if (text().includes('Альфа')) throw new Error('карта не удалилась')
  click('nav button', 'Подписки')
  await waitFor('Музыка')
  if (rowText('Музыка').includes('Альфа')) throw new Error('подписка осталась привязана к удалённой карте')

  window.__t = { click, waitFor, sleep }
  return steps.join('\n\n')
}

let failed = false
try {
  const log = await browser.evaluate(`(${flow.toString()})()`)
  // Подробный текст экранов нужен только при разборе ошибок.
  if (process.env.E2E_VERBOSE) console.log(log)
} catch (error) {
  console.log('ОШИБКА:', error.message)
  failed = true
}

// Вторая часть: проверки, которым нужен размер окна, и скриншоты экранов.
const S = process.argv[2]
const shot = async (name, js) => {
  await browser.evaluate(`(async () => { const { click, waitFor, sleep } = window.__t; ${js}; await sleep(400) })()`)
  if (S) writeFileSync(`${S}/${name}.png`, await browser.screenshot())
}
const noHorizontalScroll = `if (document.documentElement.scrollWidth > window.innerWidth) throw new Error('горизонтальная прокрутка')`
if (!failed) {
  try {
    await browser.setViewport(400, 820)
    await shot('1-home', `click('nav button', 'Сводка'); ${noHorizontalScroll}`)
    await shot('2-cards', `click('nav button', 'Кредитки'); ${noHorizontalScroll}`)
    await shot('3-card-form', `[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Сбер')).click(); await waitFor('Льготный период до')`)
    await shot('4-subs', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(150); if (document.querySelector('.modal')) throw new Error('Escape не закрыл форму'); click('nav button', 'Подписки'); ${noHorizontalScroll}`)
    await shot('5-more', `click('nav button', 'Настройки')`)
    await browser.setViewport(1500, 820)
    await shot('w1-home', `click('nav button', 'Сводка'); ${noHorizontalScroll}`)
    await shot('w2-cards', `click('nav button', 'Кредитки')`)
    await shot('w3-card-form', `[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Сбер')).click(); await waitFor('Льготный период до'); await sleep(300); const m = document.querySelector('.modal'); if (m.scrollHeight > m.clientHeight + 1) throw new Error('форма карты не помещается без прокрутки: ' + m.scrollHeight + ' > ' + m.clientHeight)`)
    await shot('w4-subs', `click('button', 'Закрыть'); await sleep(200); click('nav button', 'Подписки')`)
    await shot('w5-more', `click('nav button', 'Настройки'); ${noHorizontalScroll}`)
  } catch (error) {
    console.log('ОШИБКА:', error.message)
    failed = true
  }
}
browser.close()
process.exit(failed ? 1 : 0)
