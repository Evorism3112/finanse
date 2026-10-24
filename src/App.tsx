import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { ACCOUNT_KIND_ORDER } from './accountKinds'
import { lastBackupAt } from './backup'
import { BellIcon, ChartIcon, ChevronLeftIcon, HomeIcon, ListIcon, PlusIcon, RepeatIcon, SettingsIcon, WalletIcon } from './components/Icons'
import { today } from './dates'
import { db, type Data, type Synced, type Transaction } from './db'
import { setBackHandler } from './native'
import { notifyDue, scheduleUpcoming } from './notify'
import { AccountsPage } from './pages/AccountsPage'
import { HomePage } from './pages/HomePage'
import { MorePage } from './pages/MorePage'
import { ReportPage } from './pages/ReportPage'
import { SubscriptionsPage } from './pages/SubscriptionsPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { TxForm } from './pages/TxForm'
import { accountReminders } from './payments'
import { upcomingReminders } from './reminders'
import { saveDailySnapshot } from './snapshots'
import { accountBalances } from './stats'
import { scheduleSync } from './sync'
import { isDue, reminderText } from './subscriptions'

/**
 * Разделы. На телефоне внизу четыре главных и «+» посередине, а «Регулярные» и «Ещё» открываются кнопками
 * в шапке главной; на широком экране боковое меню показывает все.
 */
const TABS = [
  ['home', 'Главная', HomeIcon],
  ['transactions', 'Операции', ListIcon],
  ['report', 'Аналитика', ChartIcon],
  ['accounts', 'Счета', WalletIcon],
  ['subscriptions', 'Регулярные', RepeatIcon],
  ['more', 'Ещё', SettingsIcon],
] as const

type Tab = (typeof TABS)[number][0]

const EXTRA_TABS: Tab[] = ['subscriptions', 'more']

const weekdayDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

/** Через сколько дней без резервной копии начинаем о ней напоминать. */
const BACKUP_REMIND_DAYS = 7
const DAY_MS = 86_400_000

const alive = <T extends Synced>(records: T[] | undefined) => (records ?? []).filter((r) => r.deletedAt === null)

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [day, setDay] = useState(today)
  const [backupAt, setBackupAt] = useState(lastBackupAt)
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null)
  // Место в шапке для кнопки раздела, например «+ Счёт».
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)

  const accounts = useLiveQuery(() => db.accounts.toArray())
  const categories = useLiveQuery(() => db.categories.toArray())
  const transactions = useLiveQuery(() => db.transactions.toArray())
  const subscriptions = useLiveQuery(() => db.subscriptions.toArray())

  const data: Data = useMemo(
    () => ({
      // Из базы записи приходят в порядке случайных id, поэтому счета упорядочиваем по типу и времени создания.
      accounts: alive(accounts).sort(
        (a, b) => ACCOUNT_KIND_ORDER.indexOf(a.kind) - ACCOUNT_KIND_ORDER.indexOf(b.kind) || a.createdAt - b.createdAt,
      ),
      categories: alive(categories),
      transactions: alive(transactions),
      subscriptions: alive(subscriptions),
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

  // Раз в день сохраняем копию данных внутри браузера — на случай ошибочной правки.
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

  const hasAccounts = data.accounts.length > 0
  useEffect(() => {
    if (hasAccounts) void saveDailySnapshot(day)
  }, [hasAccounts, day])

  const due = useMemo(() => data.subscriptions.filter((s) => isDue(s, day)), [data.subscriptions, day])

  // Взносы и льготные периоды по кредитам и кредитным картам.
  const debtReminders = useMemo(() => {
    const balances = accountBalances(data.accounts, data.transactions)
    return data.accounts.flatMap((a) => accountReminders(a, balances.get(a.id) ?? 0, day))
  }, [data.accounts, data.transactions, day])

  useEffect(() => {
    void notifyDue([...due.map((s) => ({ id: s.id, ...reminderText(s, day) })), ...debtReminders], day)
  }, [due, debtReminders, day])

  // В приложении для телефона будущие напоминания передаются системе — они придут и при закрытом приложении.
  useEffect(() => {
    const balances = accountBalances(data.accounts, data.transactions)
    void scheduleUpcoming(upcomingReminders(data.subscriptions, data.accounts, balances, day))
  }, [data, day])

  // Данные лежат только в браузере, поэтому без свежей копии в файле их легко потерять.
  const backupDays = backupAt === null ? null : Math.floor((new Date(`${day}T23:59:59`).getTime() - backupAt) / DAY_MS)
  const backupStale = data.transactions.length > 0 && (backupDays === null || backupDays >= BACKUP_REMIND_DAYS)

  const backupNote = backupStale
    ? backupDays === null
      ? 'Резервная копия ещё не сохранялась'
      : `Резервной копии нет уже ${backupDays} дн.`
    : null

  const badges: Partial<Record<Tab, number>> = {
    home: due.length + debtReminders.length + (backupStale ? 1 : 0),
    subscriptions: due.length,
    accounts: debtReminders.length,
    more: backupStale ? 1 : 0,
  }

  const navButton = (id: Tab, label: string, TabIcon: ComponentType) => (
    <button
      key={id}
      type="button"
      className={[tab === id && 'active', EXTRA_TABS.includes(id) && 'nav-extra'].filter(Boolean).join(' ')}
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
        {EXTRA_TABS.includes(tab) && (
          <button type="button" className="icon-btn boxed header-back" aria-label="На главную" onClick={() => setTab('home')}>
            <ChevronLeftIcon />
          </button>
        )}
        <div className="header-title">
          {tab === 'home' && <span className="header-date">{weekday[0].toUpperCase() + weekday.slice(1)}</span>}
          <h1>{tab === 'home' ? 'Сводка' : TABS.find(([id]) => id === tab)![1]}</h1>
        </div>
        <div className="header-actions" ref={setHeaderSlot}>
          {tab === 'home' && (
            <>
              <button type="button" className="icon-btn boxed" aria-label={`Регулярные платежи${due.length ? `: ${due.length}` : ''}`} onClick={() => setTab('subscriptions')}>
                <BellIcon />
                {due.length > 0 && <span className="badge">{due.length}</span>}
              </button>
              <button type="button" className="icon-btn boxed" aria-label="Настройки" onClick={() => setTab('more')}>
                <SettingsIcon />
                {backupStale && <span className="badge dot" />}
              </button>
            </>
          )}
        </div>
      </header>

      <main key={tab}>
        {loading ? null : tab === 'home' ? (
          <HomePage
            {...data}
            day={day}
            due={due}
            debtReminders={debtReminders}
            backupNote={backupNote}
            onGo={setTab}
            onOpen={setEditing}
          />
        ) : tab === 'transactions' ? (
          <TransactionsPage {...data} onOpen={setEditing} />
        ) : tab === 'accounts' ? (
          <AccountsPage {...data} day={day} headerSlot={headerSlot} />
        ) : tab === 'subscriptions' ? (
          <SubscriptionsPage {...data} day={day} headerSlot={headerSlot} />
        ) : tab === 'report' ? (
          <ReportPage {...data} />
        ) : (
          <MorePage {...data} onBackup={() => setBackupAt(lastBackupAt())} />
        )}
      </main>

      <nav>
        <div className="brand">
          <img src="/icon.svg" alt="" />
          Финансы
        </div>
        {TABS.slice(0, 2).map(([id, label, TabIcon]) => navButton(id, label, TabIcon))}
        <button
          type="button"
          className="nav-add"
          aria-label="Добавить операцию"
          disabled={!hasAccounts}
          onClick={() => setEditing('new')}
        >
          <PlusIcon />
          <span>Операция</span>
        </button>
        {TABS.slice(2).map(([id, label, TabIcon]) => navButton(id, label, TabIcon))}
      </nav>

      {editing && (
        <TxForm
          tx={editing === 'new' ? null : editing}
          accounts={data.accounts}
          categories={data.categories}
          transactions={data.transactions}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
