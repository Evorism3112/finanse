import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { ACCOUNT_KIND_ORDER } from './accountKinds'
import { lastBackupAt } from './backup'
import { BellIcon, ChartIcon, ListIcon, MoreIcon, RepeatIcon, WalletIcon } from './components/Icons'
import { today } from './dates'
import { db, type Data, type Synced } from './db'
import { notifyDue } from './notify'
import { AccountsPage } from './pages/AccountsPage'
import { MorePage } from './pages/MorePage'
import { ReportPage } from './pages/ReportPage'
import { SubscriptionsPage } from './pages/SubscriptionsPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { accountReminders } from './payments'
import { accountBalances } from './stats'
import { dueText, isDue, reminderText } from './subscriptions'

const TABS = [
  ['transactions', 'Операции', ListIcon],
  ['accounts', 'Счета', WalletIcon],
  ['subscriptions', 'Регулярные', RepeatIcon],
  ['report', 'Отчёт', ChartIcon],
  ['more', 'Ещё', MoreIcon],
] as const

type Tab = (typeof TABS)[number][0]

/** Через сколько дней без резервной копии начинаем о ней напоминать. */
const BACKUP_REMIND_DAYS = 7
const DAY_MS = 86_400_000

const alive = <T extends Synced>(records: T[] | undefined) => (records ?? []).filter((r) => r.deletedAt === null)

export default function App() {
  const [tab, setTab] = useState<Tab>('transactions')
  const [day, setDay] = useState(today)
  const [backupAt, setBackupAt] = useState(lastBackupAt)

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

  const due = useMemo(() => data.subscriptions.filter((s) => isDue(s, day)), [data.subscriptions, day])

  // Взносы и льготные периоды по кредитам и кредитным картам.
  const debtReminders = useMemo(() => {
    const balances = accountBalances(data.accounts, data.transactions)
    return data.accounts.flatMap((a) => accountReminders(a, balances.get(a.id) ?? 0, day))
  }, [data.accounts, data.transactions, day])

  useEffect(() => {
    void notifyDue([...due.map((s) => ({ id: s.id, ...reminderText(s, day) })), ...debtReminders], day)
  }, [due, debtReminders, day])

  // Данные лежат только в браузере, поэтому без свежей копии в файле их легко потерять.
  const backupDays = backupAt === null ? null : Math.floor((new Date(`${day}T23:59:59`).getTime() - backupAt) / DAY_MS)
  const backupStale = data.transactions.length > 0 && (backupDays === null || backupDays >= BACKUP_REMIND_DAYS)

  const banners: { key: string; tab: Tab; text: string }[] = []
  if (due.length > 0) {
    banners.push({
      key: 'subscriptions',
      tab: 'subscriptions',
      text: due.length === 1 ? `${due[0].name}: ${dueText(due[0], day)}` : `Регулярные платежи, которые требуют внимания: ${due.length}`,
    })
  }
  if (debtReminders.length > 0) {
    banners.push({
      key: 'debts',
      tab: 'accounts',
      text:
        debtReminders.length === 1
          ? `${debtReminders[0].title}: ${debtReminders[0].text}`
          : `Кредиты и карты, которые требуют внимания: ${debtReminders.length}`,
    })
  }
  if (backupStale) {
    banners.push({
      key: 'backup',
      tab: 'more',
      text: backupDays === null ? 'Резервная копия ещё не сохранялась' : `Резервной копии нет уже ${backupDays} дн.`,
    })
  }

  const badges: Partial<Record<Tab, number>> = {
    subscriptions: due.length,
    accounts: debtReminders.length,
    more: backupStale ? 1 : 0,
  }

  return (
    <>
      <header>
        <h1>{TABS.find(([id]) => id === tab)![1]}</h1>
      </header>

      <main key={tab}>
        {tab === 'transactions' &&
          banners.map((b) => (
            <button key={b.key} type="button" className="banner" onClick={() => setTab(b.tab)}>
              <BellIcon />
              <span>{b.text}</span>
            </button>
          ))}

        {loading ? null : tab === 'transactions' ? (
          <TransactionsPage {...data} />
        ) : tab === 'accounts' ? (
          <AccountsPage {...data} day={day} />
        ) : tab === 'subscriptions' ? (
          <SubscriptionsPage {...data} day={day} />
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
        {TABS.map(([id, label, TabIcon]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <span className="nav-icon">
              <TabIcon />
              {!!badges[id] && <span className="badge">{badges[id]}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </>
  )
}
