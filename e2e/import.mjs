// Импорт выписок и основной счёт в настоящем браузере: CSV, повторный импорт без дублей, PDF через pdf.js.
// Запускается из run.mjs; первый аргумент — папка для скриншотов (необязательно).
import { writeFileSync } from 'node:fs'
import { APP_URL, connect } from './driver.mjs'

const shots = process.argv[2]
const browser = await connect()
await browser.navigate(APP_URL)
await browser.setViewport(400, 820)

/** Простейший PDF с текстом латиницей: строки выписки без банка — проверяем, что pdf.js собирает их в строки. */
function makePdf(lines) {
  const content = ['BT', '/F1 10 Tf', '40 780 Td', '14 TL', ...lines.map((l) => `(${l}) '`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return pdf
}

const csv = [
  '"Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";"MCC";"Описание"',
  '"21.10.2026 14:32:11";"22.10.2026";"*1234";"OK";"-1240,50";"RUB";"-1240,50";"RUB";"";"Супермаркеты";"5411";"Пятёрочка"',
  '"20.10.2026 12:00:00";"20.10.2026";"*1234";"OK";"-650,00";"RUB";"-650,00";"RUB";"";"Фастфуд";"5814";"Кофейня"',
  '"20.10.2026 09:00:00";"20.10.2026";"";"OK";"24000,00";"RUB";"24000,00";"RUB";"";"Пополнения";"";"Зарплата"',
  '"19.10.2026 18:00:00";"19.10.2026";"*1234";"OK";"-5000,00";"RUB";"-5000,00";"RUB";"";"Переводы";"";"Погашение кредитки"',
].join('\n')

const pdf = makePdf([
  'Statement of account',
  '18.10.2026 10:15 -990,00 RUB CINEMA PARK',
  '17.10.2026 08:00 +1 500,00 RUB CASHBACK',
  'Total -990,00',
])

const scenario = async (csv, pdf) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const text = () => document.body.innerText.replace(/[  ]/g, ' ')
  const waitFor = async (what, timeout = 8000) => {
    const start = Date.now()
    while (!text().includes(what)) {
      if (Date.now() - start > timeout) throw new Error(`не дождались «${what}». На экране:\n${text()}`)
      await sleep(50)
    }
  }
  const click = (selector, label) => {
    // У вкладок бывает значок с числом перед названием, поэтому сверяем конец текста.
    const el = [...document.querySelectorAll(selector)].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label || (selector.startsWith('nav') && b.textContent.trim().endsWith(label)))
    if (!el) throw new Error(`нет элемента ${selector} «${label}»`)
    el.click()
  }
  const field = (label) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label))
    if (!l) throw new Error(`нет поля «${label}»`)
    return l.querySelector('input, button.select')
  }
  const fill = (label, value) => {
    const el = field(label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const upload = (name, content, type) => {
    const input = document.querySelector('.import input[type="file"]')
    const dt = new DataTransfer()
    dt.items.add(new File([content], name, { type }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const openImport = () => [...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Импорт выписки')).click()
  const addAccount = async (name, favorite) => {
    click('nav button', 'Счета')
    await sleep(150)
    click('button', 'Добавить счёт')
    await waitFor('Новый счёт')
    fill('Название', name)
    if (favorite) field('Основной счёт').click()
    click('button', 'Сохранить')
    await sleep(200)
  }

  await waitFor('Сначала добавьте счёт')
  await addAccount('Сбер', false)
  await addAccount('Альфа', true)
  await addAccount('Кредитка', false)
  if (document.querySelectorAll('.row-main .star').length !== 1) throw new Error('звёздочка основного счёта не показана')

  // Новая операция: основной счёт подставлен сам и стоит первым в списке.
  click('nav button', 'Операции')
  await sleep(150)
  click('button', 'Добавить операцию')
  await waitFor('Комментарий')
  if (!field('Счёт').textContent.includes('Альфа')) throw new Error('по умолчанию выбран не основной счёт: ' + field('Счёт').textContent)
  field('Счёт').click()
  await sleep(100)
  const options = [...document.querySelectorAll('.sheet [role="option"] .option-label')].map((o) => o.textContent.trim())
  if (options.join(',') !== 'Альфа,Кредитка,Сбер') throw new Error('порядок счетов: ' + options.join(','))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(100)
  click('button', 'Закрыть')
  await sleep(150)

  // Импорт CSV: категории по категории банка, погашение кредитки — перевод на свой счёт.
  click('nav button', 'Ещё')
  await sleep(150)
  openImport()
  await waitFor('Счёт, по которому выписка')
  if (!field('Счёт, по которому выписка').textContent.includes('Альфа')) throw new Error('импорт не предложил основной счёт')
  upload('operations.csv', csv, 'text/csv')
  await waitFor('операций: 4, новых: 4')
  const rows = () => [...document.querySelectorAll('.import-list li')]
  const target = (i) => rows()[i].querySelector('.import-target button.select').textContent.trim()
  if (target(0) !== 'Продукты' || target(1) !== 'Кафе и рестораны' || target(2) !== 'Зарплата') {
    throw new Error('категории не подобраны: ' + [0, 1, 2].map(target).join(' | '))
  }
  rows()[3].querySelector('.import-target button.select').click()
  await sleep(100)
  const transfer = [...document.querySelectorAll('.sheet [role="option"]')].find((o) => o.textContent.includes('Кредитка'))
  if (!transfer) throw new Error('нет варианта перевода на свой счёт:\n' + document.querySelector('.sheet')?.innerText)
  transfer.click()
  await sleep(100)
  click('button', 'Добавить операций: 4')
  await waitFor('Добавлено операций: 4')

  click('nav button', 'Операции')
  await sleep(150)
  // Месяц в приложении — текущий, а выписка за октябрь 2026; ищем поиском по всем месяцам.
  const search = document.querySelector('input[type="search"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Пятёрочка')
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await waitFor('найдено операций: 1')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'кредитки')
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await waitFor('Счёт Альфа → Счёт Кредитка')

  // Повторный импорт того же файла ничего не задваивает.
  click('nav button', 'Ещё')
  await sleep(150)
  openImport()
  await waitFor('Счёт, по которому выписка')
  upload('operations.csv', csv, 'text/csv')
  await waitFor('новых: 0, уже записаны: 4')
  await waitFor('Ничего не выбрано')

  // PDF разбирается через pdf.js; итоговая строка пропускается, у поступления знак «+».
  upload('statement.pdf', pdf, 'application/pdf')
  await waitFor('операций: 2, новых: 2', 15000)
  await waitFor('CINEMA PARK')
  await waitFor('CASHBACK')
  if (text().includes('CASHBACK Total')) throw new Error('итоговая строка PDF попала в описание')
  if (!text().includes('−990,00') || !text().includes('+1 500,00')) throw new Error('суммы из PDF:\n' + text())
}

try {
  await browser.evaluate(`(${scenario})(${JSON.stringify(csv)}, ${JSON.stringify(pdf)})`)
  if (shots) writeFileSync(`${shots}/import-pdf.png`, await browser.screenshot())
  console.log('Импорт выписок работает: CSV с категориями и переводом, повторный импорт без дублей, PDF.')
  browser.close()
  process.exit(0)
} catch (error) {
  console.log('ОШИБКА импорта:', error.message)
  if (shots) writeFileSync(`${shots}/import-error.png`, await browser.screenshot())
  browser.close()
  process.exit(1)
}
