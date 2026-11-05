import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { lastBackupAt } from './backup'
import { CardIcon, HomeIcon, RepeatIcon, SettingsIcon } from './components/Icons'
import { today } from './dates'
import { db, type Data, type Synced } from './db'
import { setBackHandler } from './native'
import { notifyDue, scheduleUpcoming } from './notify'
import { CardsPage } from './pages/CardsPage'
import { HomePage } from './pages/HomePage'
import { MorePage } from './pages/MorePage'
import { SubscriptionsPage } from './pages/SubscriptionsPage'
import { accountReminders } from './payments'
import { upcomingReminders } from './reminders'
import { saveDailySnapshot } from './snapshots'
import { accountBalances } from './stats'
import { scheduleSync } from './sync'
import { isDue, reminderText } from './subscriptions'

/** Разделы: на телефоне — нижняя панель, на широком экране — боковое меню. */
const TABS = [
  ['home', 'Сводка', HomeIcon],
  ['cards', 'Кредитки', CardIcon],
  ['subscriptions', 'Подписки', RepeatIcon],
  ['more', 'Настройки', SettingsIcon],
] as const

export type Tab = (typeof TABS)[number][0]

const weekdayDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

/** Через сколько дней без резервной копии начинаем о ней напоминать. */
const BACKUP_REMIND_DAYS = 7
const DAY_MS = 86_400_000

const alive = <T extends Synced>(records: T[] | undefined) => (records ?? []).filter((r) => r.deletedAt === null)

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [day, setDay] = useState(today)
  const [backupAt, setBackupAt] = useState(lastBackupAt)
  // Место в шапке для кнопки раздела, например «+ Кредитка».
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)

  const accounts = useLiveQuery(() => db.accounts.toArray())
  const categories = useLiveQuery(() => db.categories.toArray())
  const transactions = useLiveQuery(() => db.transactions.toArray())
  const subscriptions = useLiveQuery(() => db.subscriptions.toArray())

  // Приложение ведёт только кредитки и подписки. Обычные счета, кредиты и регулярные доходы из прежних версий
  // остаются в базе и в резервных копиях, но не показываются и не напоминают о себе.
  const data: Data = useMemo(
    () => ({
      // Из базы записи приходят в порядке случайных id, поэтому карты упорядочиваем по времени создания.
      accounts: alive(accounts)
        .filter((a) => a.kind === 'credit_card')
        .sort((a, b) => a.createdAt - b.createdAt),
      categories: alive(categories),
      // Операции нужны целиком: из них складывается долг карты, в том числе взносы, записанные прежними версиями.
      transactions: alive(transactions),
      subscriptions: alive(subscriptions).filter((s) => s.direction === 'expense'),
    }),
    [accounts, categories, transactions, subscriptions],
  )
  const loading = !accounts || !categories || !transactions || !subscriptions

  useEffect(() => {
    setBackHandler(() => {
      if (tab === 'home') return false
      setTab('home')
      return true
    })
  }, [tab])

  // Приложение может быть открыто сутками: следим за сменой даты, чтобы напоминания не отставали.
  useEffect(() => {
    const refresh = () => setDay(today())
    const timer = setInterval(refresh, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  // Синхронизация с сервером, если она подключена: после правок, раз в минуту и при возвращении в приложение.
  useEffect(() => {
    scheduleSync()
  }, [accounts, categories, transactions, subscriptions])
  useEffect(() => {
    const now = () => scheduleSync(0)
    const timer = setInterval(now, 60_000)
    document.addEventListener('visibilitychange', now)
    now()
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', now)
    }
  }, [])

  // Раз в день сохраняем копию данных внутри браузера — на случай ошибочной правки.
  const hasData = data.accounts.length + data.subscriptions.length > 0
  useEffect(() => {
    if (hasData) void saveDailySnapshot(day)
  }, [hasData, day])

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])

  const due = useMemo(() => data.subscriptions.filter((s) => isDue(s, day)), [data.subscriptions, day])

  // Платежи, выписки и льготные периоды по кредиткам.
  const cardReminders = useMemo(
    () => data.accounts.flatMap((a) => accountReminders(a, balances.get(a.id) ?? 0, day)),
    [data.accounts, balances, day],
  )

  useEffect(() => {
    void notifyDue([...due.map((s) => ({ id: s.id, ...reminderText(s, day) })), ...cardReminders], day)
  }, [due, cardReminders, day])

  // В приложении для телефона будущие напоминания передаются системе — они придут и при закрытом приложении.
  useEffect(() => {
    void scheduleUpcoming(upcomingReminders(data.subscriptions, data.accounts, balances, day))
  }, [data.subscriptions, data.accounts, balances, day])

  // Данные лежат только на устройстве, поэтому без свежей копии в файле их легко потерять.
  const backupDays = backupAt === null ? null : Math.floor((new Date(`${day}T23:59:59`).getTime() - backupAt) / DAY_MS)
  const backupStale = hasData && (backupDays === null || backupDays >= BACKUP_REMIND_DAYS)

  const backupNote = backupStale
    ? backupDays === null
      ? 'Резервная копия ещё не сохранялась'
      : `Резервной копии нет уже ${backupDays} дн.`
    : null

  const badges: Partial<Record<Tab, number>> = {
    home: due.length + cardReminders.length + (backupStale ? 1 : 0),
    cards: cardReminders.length,
    subscriptions: due.length,
    more: backupStale ? 1 : 0,
  }

  const navButton = (id: Tab, label: string, TabIcon: ComponentType) => (
    <button
      key={id}
      type="button"
      className={tab === id ? 'active' : undefined}
      aria-current={tab === id ? 'page' : undefined}
      onClick={() => setTab(id)}
    >
      <span className="nav-icon">
        <TabIcon />
        {!!badges[id] && <span className="badge">{badges[id]}</span>}
      </span>
      {label}
    </button>
  )

  const weekday = weekdayDate.format(new Date(`${day}T12:00:00`))

  return (
    <>
      <header>
        <div className="header-title">
          {tab === 'home' && <span className="header-date">{weekday[0].toUpperCase() + weekday.slice(1)}</span>}
          <h1>{TABS.find(([id]) => id === tab)![1]}</h1>
        </div>
        <div className="header-actions" ref={setHeaderSlot} />
      </header>

      <main key={tab}>
        {loading ? null : tab === 'home' ? (
          <HomePage
            {...data}
            balances={balances}
            day={day}
            cardReminders={cardReminders}
            backupNote={backupNote}
            onGo={setTab}
          />
        ) : tab === 'cards' ? (
          <CardsPage {...data} balances={balances} day={day} headerSlot={headerSlot} />
        ) : tab === 'subscriptions' ? (
          <SubscriptionsPage {...data} day={day} headerSlot={headerSlot} />
        ) : (
          <MorePage onBackup={() => setBackupAt(lastBackupAt())} />
        )}
      </main>

      <nav>
        <div className="brand">
          <img src="/icon.svg" alt="" />
          Финансы
        </div>
        {TABS.map(([id, label, TabIcon]) => navButton(id, label, TabIcon))}
      </nav>
    </>
  )
}
