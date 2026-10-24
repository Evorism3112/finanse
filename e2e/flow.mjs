// Сквозной сценарий: проходит по всему приложению в настоящем браузере.
// Запускается из run.mjs; первый аргумент — папка для скриншотов (необязательно).
import { writeFileSync } from 'node:fs'
import { APP_URL, connect } from './driver.mjs'

const browser = await connect()
await browser.navigate(APP_URL)

const flow = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const text = () => document.body.innerText
  const waitFor = async (what, timeout = 5000) => {
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
  const field = (label) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label))
    if (!l) throw new Error(`нет поля «${label}»`)
    return l.querySelector('input, select, button.select')
  }
  const fill = (label, value) => {
    const el = field(label)
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }
  const choose = async (label, optionText) => {
    field(label).click()
    await sleep(80)
    const option = [...document.querySelectorAll('.sheet [role="option"]')].find((o) => o.querySelector('.option-label').textContent.trim() === optionText)
    if (!option) throw new Error(`нет варианта «${optionText}» в «${label}»:\n` + document.querySelector('.sheet')?.innerText)
    option.click()
    await sleep(80)
    if (document.querySelector('.sheet')) throw new Error('список не закрылся после выбора')
    if (!field(label).textContent.trim().endsWith(optionText)) throw new Error(`в поле «${label}» не показан выбор «${optionText}»`)
  }
  const norm = (s) => s.replace(/[  ]/g, ' ')
  const steps = []
  const snap = (name) => steps.push(`--- ${name} ---\n${norm(text())}`)

  await waitFor('Сначала добавьте счёт')
  snap('пустой старт')

  click('nav button', 'Счета')
  await waitFor('Счетов пока нет')
  click('button', 'Добавить счёт')
  await waitFor('Новый счёт')
  fill('Название', 'Карта')
  fill('Начальный остаток', '1000')
  // Основной счёт подставляется в новые операции; без него выбрался бы первый по алфавиту — «Доллары».
  field('Основной счёт').click()
  click('button', 'Сохранить')
  await waitFor('Всего')

  click('button', 'Добавить счёт')
  await waitFor('Новый счёт')
  fill('Название', 'Доллары')
  await choose('Валюта', 'USD')
  click('button', 'Сохранить')
  await waitFor('Доллары')
  snap('счета созданы')

  click('nav button', 'Операции')
  await waitFor('операций нет')
  click('button', 'Добавить операцию')
  await waitFor('Новая операция')
  fill('Сумма', 'abc')
  click('button', 'Сохранить')
  await waitFor('Введите сумму больше нуля')
  fill('Сумма', '250,50')
  await choose('Категория', 'Продукты')
  fill('Комментарий', 'молоко')
  click('button', 'Сохранить')
  await waitFor('молоко')

  click('button', 'Добавить операцию')
  await waitFor('Новая операция')
  click('.segmented button', 'Перевод')
  await sleep(50)
  fill('Сумма', '180')
  await choose('На счёт', 'Доллары')
  await waitFor('Сумма зачисления, USD')
  fill('Сумма зачисления', '2')
  click('button', 'Сохранить')
  await waitFor('Счёт Карта → Счёт Доллары')
  snap('операции')

  click('nav button', 'Счета')
  await waitFor('Всего')
  snap('остатки')

  click('nav button', 'Отчёт')
  await waitFor('Расходы по категориям')
  snap('отчёт')

  click('nav button', 'Ещё')
  await waitFor('Резервная копия')
  ;[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Категории')).click()
  await waitFor('Зарплата')
  click('button', '+ Добавить категорию')
  await waitFor('Новая категория расходов')
  fill('Название', 'Подарки')
  click('button', 'Сохранить')
  await waitFor('Подарки')
  ;[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Продукты')).click()
  await waitFor('Лимит расходов в месяц, RUB')
  fill('Лимит расходов', '5000')
  click('button', 'Сохранить')
  await waitFor('лимит 5')
  snap('категории')

  // Удаление операции и проверка, что остаток вернулся.
  click('nav button', 'Операции')
  await waitFor('молоко')
  ;[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('молоко')).click()
  await waitFor('Удалить')
  // Удаление подтверждается вторым нажатием на ту же кнопку, без системного окна.
  click('button', 'Удалить')
  await waitFor('Точно удалить?')
  if (!text().includes('молоко')) throw new Error('операция удалилась с первого нажатия')
  click('button', 'Точно удалить?')
  await sleep(300)
  if (text().includes('молоко')) throw new Error('операция не удалилась')
  click('nav button', 'Счета')
  await waitFor('Всего')
  snap('после удаления расхода')

  const addTx = async (type, amount, category, note) => {
    click('nav button', 'Операции')
    await sleep(100)
    click('button', 'Добавить операцию')
    await waitFor('Новая операция')
    click('.segmented button', type)
    await sleep(50)
    fill('Сумма', amount)
    await choose('Категория', category)
    fill('Комментарий', note)
    click('button', 'Сохранить')
    await waitFor(note)
  }
  await addTx('Доход', '85000', 'Зарплата', 'аванс')
  await addTx('Расход', '3240,50', 'Продукты', 'супермаркет')
  await addTx('Расход', '1200', 'Транспорт', 'проездной')
  await addTx('Расход', '2100', 'Кафе и рестораны', 'ужин')
  await addTx('Расход', '900', 'Подарки', 'цветы')

  const addAccount = async (kind, name, fields) => {
    click('nav button', 'Счета')
    await sleep(150)
    click('button', 'Добавить счёт')
    await waitFor('Новый счёт')
    await choose('Тип счёта', kind)
    await sleep(50)
    fill('Название', name)
    for (const [label, value] of Object.entries(fields)) fill(label, value)
    click('button', 'Сохранить')
    await waitFor(name)
  }
  await addAccount('Сберегательный счёт', 'Накопления', { 'Начальный остаток': '150000', 'Ставка': '16', 'Цель': '500000' })
  await addAccount('Кредитная карта', 'Кредитка', { 'Кредитный лимит': '100000', 'Текущий долг': '23500' })
  await addAccount('Кредит', 'Автокредит', { 'Остаток долга': '800000', 'Ставка': '18,5' })

  // Платёж по кредиту — перевод на счёт кредита.
  click('nav button', 'Операции')
  await sleep(150)
  click('button', 'Добавить операцию')
  await waitFor('Новая операция')
  click('.segmented button', 'Перевод')
  await sleep(50)
  fill('Сумма', '20000')
  await choose('На счёт', 'Автокредит')
  click('button', 'Сохранить')
  await waitFor('Счёт Карта → Автокредит')
  click('nav button', 'Счета')
  await waitFor('Погашено')
  snap('счета всех типов')

  const inDays = (n) => {
    const d = new Date(Date.now() + n * 86400000)
    const pad = (x) => String(x).padStart(2, '0')
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`
  }
  const addSub = async (name, amount, period, days) => {
    click('nav button', 'Регулярные')
    await sleep(150)
    click('button', 'Добавить регулярный платёж')
    await waitFor('Новый регулярный платёж')
    fill('Название', name)
    fill('Стоимость', amount)
    await choose('Периодичность', period)
    fill('Следующее списание', inDays(days))
    click('button', 'Сохранить')
    await waitFor(name)
  }
  // Поле даты: неполная дата не сохраняется, точки подставляются сами.
  click('nav button', 'Регулярные')
  await sleep(150)
  click('button', 'Добавить регулярный платёж')
  await waitFor('Новый регулярный платёж')
  fill('Название', 'Проверка даты')
  fill('Стоимость', '1')
  // Набор по одной цифре, как с клавиатуры: точки подставляются сами.
  fill('Следующее списание', '')
  for (const typed of ['3', '31', '31.0', '31.02']) fill('Следующее списание', typed)
  if (field('Следующее списание').value !== '31.02.') throw new Error('маска даты: ' + field('Следующее списание').value)
  // Стирание точки не должно возвращать её обратно.
  fill('Следующее списание', '31.02')
  if (field('Следующее списание').value !== '31.02') throw new Error('точка не стирается: ' + field('Следующее списание').value)
  click('button', 'Сохранить')
  await waitFor('Укажите дату')
  fill('Следующее списание', '310226')
  click('button', 'Сохранить')
  await sleep(200)
  if (!text().includes('Укажите дату')) throw new Error('31 февраля принято за дату')
  click('button', 'Закрыть')
  await sleep(200)

  await addSub('Кино', '399', 'Каждый месяц', 2)
  click('nav button', 'Операции')
  await waitFor('Кино: списание через 2 дн.')
  snap('баннер напоминания')

  // Оплата отмечается кнопкой прямо в строке, без захода в форму.
  click('nav button', 'Регулярные')
  await sleep(150)
  click('.chip', 'Оплачено')
  await waitFor('Оплачено: Кино')
  document.querySelector('.modal button[type="submit"]').click()
  await sleep(300)
  click('nav button', 'Операции')
  await waitFor('Счёт Карта · Кино')
  if (text().includes('списание через')) throw new Error('баннер не исчез после оплаты')
  snap('после оплаты подписки')

  await addSub('Музыка', '299', 'Каждый месяц', 1)
  await addSub('Облако', '2990', 'Каждый год', 40)
  snap('подписки')

  // Регулярный доход: отметка «Получено» записывает доход.
  click('nav button', 'Регулярные')
  await sleep(150)
  click('button', 'Добавить регулярный платёж')
  await waitFor('Новый регулярный платёж')
  click('.segmented button', 'Доход')
  await waitFor('Следующее поступление')
  fill('Название', 'Зарплата основная')
  fill('Сумма', '90000')
  fill('Следующее поступление', inDays(1))
  click('button', 'Сохранить')
  await waitFor('поступление завтра')
  // Фактическая сумма отличается от плановой: в операции идёт она, а план остаётся прежним.
  click('.chip', 'Получено')
  await waitFor('Получено: Зарплата основная')
  fill('Сколько пришло', '93500')
  await waitFor('По плану было')
  document.querySelector('.modal button[type="submit"]').click()
  await sleep(300)
  if (!norm(text()).includes('+90 000,00 ₽ / мес.')) throw new Error('плановая сумма изменилась:\n' + norm(text()))
  // Списки доходов и расходов разделены.
  const heads = [...document.querySelectorAll('.split-main .group-head h3')].map((h) => h.textContent)
  if (heads.length !== 2 || !heads[0].includes('Доходы') || !heads[1].includes('Расходы')) throw new Error('группы: ' + heads.join(' | '))
  click('nav button', 'Операции')
  await waitFor('Счёт Карта · Зарплата основная')
  if (!norm(text()).includes('+93 500,00')) throw new Error('доход на фактическую сумму не появился')

  // Доход двумя выплатами в месяц: аванс и основная часть отмечаются по отдельности.
  click('nav button', 'Регулярные')
  await sleep(150)
  click('button', 'Добавить регулярный платёж')
  await waitFor('Новый регулярный платёж')
  click('.segmented button', 'Доход')
  await waitFor('Выплат в месяц')
  fill('Название', 'ЗП частями')
  await choose('Выплат в месяц', '2')
  await waitFor('Выплата 2 — число месяца')
  const dayIn = (n) => String(new Date(Date.now() + n * 86400000).getDate())
  fill('Выплата 1 — число месяца', dayIn(10))
  fill('Выплата 1 — сумма', '36000')
  fill('Выплата 2 — число месяца', '40')
  fill('Выплата 2 — сумма', '24000')
  click('button', 'Сохранить')
  await waitFor('Выплата 2: число месяца — от 1 до 31')
  fill('Выплата 2 — число месяца', dayIn(1))
  await waitFor('Итого в месяц')
  if (!norm(text()).includes('Итого в месяц: 60 000,00 ₽')) throw new Error('итог выплат:\n' + norm(text()))
  click('button', 'Сохранить')
  await waitFor('ЗП частями')
  const partsRow = () => norm([...document.querySelectorAll('.list li')].find((li) => li.textContent.includes('ЗП частями')).innerText)
  if (!partsRow().includes('поступление завтра') || !partsRow().includes('+24 000,00 ₽ из 60 000,00 ₽ в мес.')) throw new Error('первая выплата:\n' + partsRow())
  // Отметка первой выплаты переводит запись на вторую, с её суммой.
  click('.chip', 'Получено')
  await waitFor('Получено: ЗП частями')
  fill('Сколько пришло', '24000')
  document.querySelector('.modal button[type="submit"]').click()
  await sleep(300)
  if (!partsRow().includes('поступление через 10 дн.') || !partsRow().includes('+36 000,00 ₽ из 60 000,00 ₽ в мес.')) throw new Error('вторая выплата:\n' + partsRow())
  if (!norm(text()).includes('150 000,00')) throw new Error('регулярные доходы в месяц должны быть 90 000 + 60 000:\n' + norm(text()))
  click('nav button', 'Операции')
  await waitFor('Счёт Карта · ЗП частями')
  if (!norm(text()).includes('+24 000,00')) throw new Error('доход по первой выплате не записан')

  // Поиск идёт по всем месяцам и по комментарию, и по сумме.
  const typeSearch = async (value) => {
    const input = document.querySelector('input[type="search"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(150)
  }
  await typeSearch('супермаркет')
  await waitFor('найдено операций: 1')
  if (document.querySelectorAll('.split-main .row').length !== 1) throw new Error('поиск по комментарию показал лишнее')
  await typeSearch('3240,50')
  await waitFor('найдено операций: 1')
  await typeSearch('такого точно нет')
  await waitFor('Ничего не найдено')
  await typeSearch('')
  await waitFor('Доходы')

  // Напоминание о резервной копии исчезает после экспорта.
  await waitFor('Резервная копия ещё не сохранялась')
  click('nav button', 'Ещё')
  await waitFor('Копия с этого устройства ещё не сохранялась')
  click('button', 'Экспорт в файл')
  await waitFor('Последняя копия с этого устройства')
  click('nav button', 'Операции')
  await sleep(200)
  if (text().includes('Резервная копия ещё не сохранялась')) throw new Error('напоминание о копии не исчезло')

  // Взносы по кредиту: график, напоминание, взнос с процентами.
  // Взнос вносится кнопкой прямо в строке счёта, без захода в карточку.
  const payChip = async (name) => {
    click('nav button', 'Счета')
    await sleep(150)
    const item = [...document.querySelectorAll('.list li')].find((li) => li.textContent.includes(name))
    const chip = item?.querySelector('.chip')
    if (!chip) throw new Error(`нет кнопки взноса в строке «${name}»`)
    chip.click()
  }
  const submitModal = () => document.querySelector('.modal button[type="submit"]').click()
  const openAccount = async (name) => {
    click('nav button', 'Счета')
    await sleep(150)
    ;[...document.querySelectorAll('.row')].find((r) => r.textContent.includes(name)).click()
    await waitFor('Тип счёта')
  }
  await openAccount('Автокредит')
  fill('Ежемесячный платёж', '25000')
  fill('Дата следующего платежа', inDays(2))
  click('button', 'Сохранить')
  await waitFor('платёж через 2 дн.')
  snap('кредит с графиком')
  click('nav button', 'Операции')
  await waitFor('Автокредит: платёж через 2 дн.')

  await payChip('Автокредит')
  await waitFor('Взнос: Автокредит')
  fill('Из них проценты', '12000')
  await waitFor('Долг после взноса')
  if (!norm(text()).includes('Долг после взноса: 767 000,00')) throw new Error('неверный прогноз долга:\n' + norm(text()))
  // Взнос больше долга по кредиту не принимается.
  fill('Сумма взноса', '900000')
  submitModal()
  await waitFor('Взнос больше остатка долга')
  fill('Сумма взноса', '25000')
  // Следующий платёж не может быть раньше взноса.
  fill('Дата следующего платежа', inDays(-3))
  submitModal()
  await waitFor('должен быть позже')
  fill('Дата следующего платежа', inDays(20))
  fill('Размер следующего платежа', '26000')
  submitModal()
  await waitFor('Погашено 4')
  await waitFor('платёж через 20 дн.')
  if (!norm(text()).includes('26 000,00')) throw new Error('новый размер платежа не сохранился')
  if (!/платёж через \d+ дн\. · \d\d\.\d\d\.\d\d · /.test(norm(text()))) throw new Error('дата платежа не в формате ДД.ММ.ГГ:\n' + norm(text()))
  if (!norm(text()).includes('-767 000,00')) throw new Error('остаток кредита после взноса неверный:\n' + norm(text()))
  snap('после взноса')
  click('nav button', 'Операции')
  await waitFor('Карта → Автокредит')
  if (text().includes('Автокредит: платёж')) throw new Error('напоминание о взносе не исчезло')
  if (!text().includes('Проценты по кредитам')) throw new Error('нет расхода на проценты')

  // Кредитка: проценты в долге не занимают лимит, полное погашение снимает график.
  await openAccount('Кредитка')
  fill('Проценты в долге', '3500')
  fill('Дата следующего платежа', inDays(5))
  fill('Льготный период до', inDays(6))
  await waitFor('Погасить до этой даты')
  fill('Погасить до этой даты', '10000')
  click('button', 'Сохранить')
  await waitFor('платёж через 5 дн.')
  if (!norm(text()).includes('через 6 дн. · погасить 10 000,00 ₽')) throw new Error('строка льготного периода:\n' + norm(text()))
  click('nav button', 'Операции')
  await waitFor('Кредитка: льготный период заканчивается через 6 дн.')
  click('nav button', 'Счета')
  await waitFor('Доступно 80')
  if (!norm(text()).includes('Доступно 80 000,00 ₽ из 100 000,00 ₽ · проценты 3 500,00 ₽')) throw new Error('лимит с процентами:\n' + norm(text()))
  snap('кредитка с процентами')

  // Взнос на сумму льготного периода выполняет условие и спрашивает следующий срок.
  await payChip('Кредитка')
  await waitFor('Взнос: Кредитка')
  click('button', 'Погасить для льготного периода')
  await waitFor('Условие льготного периода будет выполнено')
  if (field('Сумма взноса').value !== '10000,00') throw new Error('сумма для льготного периода: ' + field('Сумма взноса').value)
  fill('Следующий льготный период до', inDays(40))
  submitModal()
  await sleep(400)
  click('nav button', 'Счета')
  await waitFor('через 40 дн.')
  if (!norm(text()).includes('через 40 дн. · погасить 13 500,00 ₽')) throw new Error('новый льготный период:\n' + norm(text()))
  click('nav button', 'Операции')
  await sleep(200)
  if (text().includes('льготный период заканчивается')) throw new Error('напоминание о льготном периоде не исчезло')

  await payChip('Кредитка')
  await waitFor('Взнос: Кредитка')
  await waitFor('погашен полностью')
  submitModal()
  await sleep(400)
  click('nav button', 'Счета')
  await waitFor('Доступно 100')
  if (text().includes('платёж через 5 дн.')) throw new Error('график не снят после полного погашения')
  if (text().includes('проценты 3')) throw new Error('проценты не обнулились')
  if (text().includes('без % до')) throw new Error('льготный период не снят после полного погашения')

  // Отчёт: лимит категории и динамика.
  click('nav button', 'Отчёт')
  await waitFor('Лимиты на месяц')
  await waitFor('Динамика за 6 месяцев')
  if (!norm(text()).includes('Осталось 1 759,50 ₽')) throw new Error('остаток лимита:\n' + norm(text()))
  snap('кредитка погашена')

  // Автокопия: возврат к утреннему состоянию и обратно.
  click('nav button', 'Ещё')
  await waitFor('Автокопии на этом устройстве')
  await waitFor('операций: 0')
  click('.snapshots button', 'Вернуть')
  await waitFor('Заменить данные?')
  click('.snapshots button', 'Заменить данные?')
  await waitFor('Данные возвращены к копии')
  click('nav button', 'Счета')
  await waitFor('Карта')
  if (text().includes('Автокредит') || !norm(text()).includes('1 000,00 ₽')) throw new Error('восстановление не вернуло старое состояние:\n' + norm(text()))
  click('nav button', 'Ещё')
  await waitFor('перед восстановлением')
  click('.snapshots button', 'Вернуть')
  await waitFor('Заменить данные?')
  click('.snapshots button', 'Заменить данные?')
  await sleep(500)
  click('nav button', 'Счета')
  await waitFor('Автокредит')
  if (!norm(text()).includes('-767 000,00 ₽')) throw new Error('отмена восстановления не вернула данные:\n' + norm(text()))

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
if (!failed) {
  try {
    await browser.setViewport(400, 820)
    await shot('1-ops', `click('nav button', 'Операции')`)
    await shot('2-form', `click('button', 'Добавить операцию'); await waitFor('Новая операция')`)
    await shot('2b-select', `[...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith('Счёт')).querySelector('button.select').click()`)
    await shot('2c-select-category', `document.querySelector('.sheet [aria-label="Закрыть список"]').click(); await sleep(100); [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith('Категория')).querySelector('button.select').click()`)
    await shot('2d-closed', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sleep(100); if (document.querySelector('.sheet')) throw new Error('Escape не закрыл список'); if (!document.querySelector('.modal')) throw new Error('Escape закрыл и форму под списком')`)
    await shot('2e-calendar', `document.querySelector('[aria-label="Открыть календарь"]').click(); await waitFor('Выбор даты'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100); if (document.querySelector('.calendar')) throw new Error('Escape не закрыл календарь'); if (!document.querySelector('.modal')) throw new Error('Escape закрыл и форму под календарём'); document.querySelector('[aria-label="Открыть календарь"]').click(); await waitFor('Выбор даты')`)
    await shot('2f-picked', `
      document.querySelector('.calendar [aria-label="Предыдущий месяц"]').click(); await sleep(80)
      const head = document.querySelector('.calendar-nav span').textContent
      if (!/^[А-Я][а-я]+ \\d{4}/.test(head)) throw new Error('заголовок календаря: ' + head)
      if (document.querySelector('.calendar .weekday').textContent !== 'Пн') throw new Error('неделя не с понедельника')
      ;[...document.querySelectorAll('.calendar .day')].find((d) => d.textContent === '15').click(); await sleep(100)
      if (document.querySelector('.calendar')) throw new Error('календарь не закрылся после выбора')
      const v = document.querySelector('.date-input input').value
      if (!/^15\\.\\d\\d\\.\\d\\d$/.test(v)) throw new Error('дата после выбора: ' + v)
    `)
    await shot('3-accounts', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(150); if (document.querySelector('.modal')) throw new Error('Escape не закрыл форму'); click('nav button', 'Счета')`)
    await shot('4-report', `click('nav button', 'Отчёт')`)
    await browser.setViewport(1500, 820)
    await shot('7-wide-account', `click('nav button', 'Счета'); await sleep(200); [...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Автокредит')).click(); await waitFor('Тип счёта'); await sleep(300); const m = document.querySelector('.modal'); if (m.scrollHeight > m.clientHeight + 1) throw new Error('форма счёта не помещается без прокрутки: ' + m.scrollHeight + ' > ' + m.clientHeight)`)
    await shot('8-wide-payment', `click('button', 'Закрыть'); await sleep(200); document.querySelector('.chip').click(); await waitFor('Взнос:'); await sleep(300)`)
    await shot('w1-accounts', `click('button', 'Закрыть'); await sleep(200)`)
    await shot('w2-ops', `click('nav button', 'Операции')`)
    await shot('w3-report', `click('nav button', 'Отчёт')`)
    await shot('w4-subs', `click('nav button', 'Регулярные')`)
    await shot('w5-more', `click('nav button', 'Ещё'); await sleep(100); if (document.documentElement.scrollWidth > window.innerWidth) throw new Error('горизонтальная прокрутка на широком экране')`)
    await shot('w6-accounts-again', `click('nav button', 'Счета'); await sleep(200); document.querySelector('.chip').click(); await waitFor('Взнос:')`)
    await browser.setViewport(400, 820)
    await shot('9-accounts-chip', `click('button', 'Закрыть'); await sleep(200); window.scrollTo(0, document.body.scrollHeight)`)
    await shot('5-subs', `click('nav button', 'Регулярные')`)
    await shot('6-more', `click('nav button', 'Ещё')`)
  } catch (error) {
    console.log('ОШИБКА:', error.message)
    failed = true
  }
}
browser.close()
process.exit(failed ? 1 : 0)
