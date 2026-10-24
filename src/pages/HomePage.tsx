import { useMemo, useState } from 'react'
import { ACCOUNT_KINDS } from '../accountKinds'
import { queueQuestion } from '../assistant'
import { colorOf } from '../colors'
import { Avatar } from '../components/Avatar'
import { ArrowInIcon, ArrowOutIcon, CardIcon, ShieldIcon, SparkIcon } from '../components/Icons'
import { TxRow } from '../components/TxRow'
import { currentMonth, formatDate, monthLabel } from '../dates'
import type { Account, Data, Subscription, Transaction } from '../db'
import { dailyBudget, monthForecast, tips } from '../insights'
import { formatAmount } from '../money'
import type { AccountReminder } from '../payments'
import { accountBalances, mainCurrency, monthReport, netWorthByCurrency } from '../stats'
import { dueText } from '../subscriptions'
import { PaymentForm } from './PaymentForm'
import { PayForm } from './SubscriptionsPage'

/** Сколько последних операций показывает главная. */
const RECENT = 5
/** В полосе по категориям — пять крупнейших, остальное одним отрезком. */
const BAR_SLICES = 5

export type HomeTarget = 'transactions' | 'accounts' | 'subscriptions' | 'report' | 'more' | 'assistant'

export function HomePage({
  accounts,
  categories,
  transactions,
  subscriptions,
  day,
  due,
  debtReminders,
  backupNote,
  onGo,
  onOpen,
}: Data & {
  day: string
  due: Subscription[]
  debtReminders: AccountReminder[]
  /** Текст напоминания о резервной копии или null, если копия свежая. */
  backupNote: string | null
  onGo: (target: HomeTarget) => void
  onOpen: (tx: Transaction) => void
}) {
  const [paying, setPaying] = useState<Subscription | null>(null)
  const [payingDebt, setPayingDebt] = useState<Account | null>(null)

  const currency = mainCurrency(accounts)
  const month = currentMonth()
  const balances = useMemo(() => accountBalances(accounts, transactions), [accounts, transactions])
  const worth = useMemo(() => netWorthByCurrency(accounts, balances), [accounts, balances])
  const main = worth.find((w) => w.currency === currency)
  const others = worth.filter((w) => w !== main && w.assets > 0)
  const report = useMemo(() => monthReport(accounts, transactions, month).find((r) => r.currency === currency), [accounts, transactions, month, currency])

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const budget = useMemo(() => dailyBudget(accounts, balances, subscriptions, day), [accounts, balances, subscriptions, day])
  const forecast = useMemo(() => monthForecast(accounts, transactions, day), [accounts, transactions, day])
  const advice = useMemo(
    () => tips(accounts, categories, transactions, subscriptions, balances, day),
    [accounts, categories, transactions, subscriptions, balances, day],
  )
  const recent = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, RECENT),
    [transactions],
  )

  if (accounts.length === 0) {
    return (
      <div className="card welcome">
        <span className="avatar accent">
          <CardIcon />
        </span>
        <h2>Добро пожаловать</h2>
        <p className="muted">Сначала добавьте счёт на вкладке «Счета» — например, «Карта» или «Наличные».</p>
        <button type="button" className="primary" onClick={() => onGo('accounts')}>
          Добавить счёт
        </button>
      </div>
    )
  }

  const money = (minor: number) => formatAmount(minor, currency)
  const ask = (question: string) => {
    queueQuestion(question)
    onGo('assistant')
  }
  const expenses = report?.expenseByCategory ?? []
  const shown = expenses.slice(0, BAR_SLICES)
  const rest = (report?.expense ?? 0) - shown.reduce((sum, c) => sum + c.amount, 0)
  const nameOf = (id: string | null) => (id && categoryById.get(id)?.name) || 'Без категории'
  const attention = due.length + debtReminders.length + (backupNote ? 1 : 0)

  return (
    <div className="home">
      <section className="hero accent">
        <span>Свои средства</span>
        <strong>{money(main?.assets ?? 0)}</strong>
        {others.length > 0 && <span className="hero-extra">и {others.map((w) => formatAmount(w.assets, w.currency)).join(', ')}</span>}
        {main && main.debts > 0 && (
          <div className="hero-tiles">
            <div>
              <span>Долги</span>
              <b>{money(main.debts)}</b>
            </div>
            <div>
              <span>С учётом долгов</span>
              <b>{money(main.assets - main.debts)}</b>
            </div>
          </div>
        )}
      </section>

      <section className="card budget-card">
        <div className="budget-main">
          <span className="muted">Можно тратить в день</span>
          <strong className={budget.free < 0 ? 'amount expense' : 'amount'}>{money(budget.perDay)}</strong>
          <span className="muted wrap">
            {budget.payday ? `до дохода ${formatDate(budget.until)}` : 'до конца месяца'} · {budget.days} дн. ·{' '}
            {budget.free < 0 ? `не хватает ${money(-budget.free)}` : `свободно ${money(budget.free)}`}
          </span>
        </div>
        <button type="button" className="chip" onClick={() => ask('сколько можно тратить в день')}>
          Как считается
        </button>
      </section>

      <div className="home-columns">
        <div className="home-column">
          <section className="card">
            <div className="card-head">
              <h2>{monthLabel(month).split(' ')[0]}</h2>
              <button type="button" className="link" onClick={() => onGo('report')}>
                Аналитика
              </button>
            </div>
            <div className="flow">
              <div>
                <span className="avatar income">
                  <ArrowInIcon />
                </span>
                <span className="flow-text">
                  <span className="muted">Доходы</span>
                  <strong className="amount income">+{money(report?.income ?? 0)}</strong>
                </span>
              </div>
              <div>
                <span className="avatar expense">
                  <ArrowOutIcon />
                </span>
                <span className="flow-text">
                  <span className="muted">Расходы</span>
                  <strong className="amount expense">−{money(report?.expense ?? 0)}</strong>
                </span>
              </div>
            </div>
            {forecast && (
              <p className="forecast">
                Прогноз на месяц: ≈ {money(forecast.forecast)}
                {forecast.usual ? <span className="muted"> · обычно {money(forecast.usual)}</span> : null}
              </p>
            )}
            {shown.length > 0 && (
              <>
                <div className="stack-bar" aria-hidden="true">
                  {shown.map((c) => (
                    <span key={c.categoryId ?? ''} style={{ flexGrow: c.amount, background: c.categoryId ? colorOf(c.categoryId) : 'var(--muted)' }} />
                  ))}
                  {rest > 0 && <span style={{ flexGrow: rest, background: 'var(--surface-3)' }} />}
                </div>
                <ul className="legend">
                  {shown.map((c) => (
                    <li key={c.categoryId ?? ''}>
                      <span className="swatch" style={{ background: c.categoryId ? colorOf(c.categoryId) : 'var(--muted)' }} />
                      {nameOf(c.categoryId)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {attention > 0 && (
            <section>
              <div className="section-head">
                <h2>Требует внимания</h2>
                <span className="count warn">{attention}</span>
              </div>
              <ul className="list">
                {due.map((s) => (
                  <li key={s.id} className="attention">
                    <Avatar id={s.categoryId ?? s.id} label={s.name} />
                    <span className="row-main">
                      <span className="wrap">
                        {s.name} · {formatAmount(s.amount, s.currency)}
                      </span>
                      <span className="muted soon">{dueText(s, day)}</span>
                    </span>
                    <button type="button" className="chip" onClick={() => setPaying(s)}>
                      {s.direction === 'income' ? 'Получено' : 'Оплачено'}
                    </button>
                  </li>
                ))}
                {debtReminders.map((r) => {
                  const account = accountById.get(r.id.split(':')[0])
                  const kind = ACCOUNT_KINDS.find((k) => k.kind === account?.kind)
                  return (
                    <li key={r.id} className="attention">
                      <Avatar id={account?.id} label={r.title} color={kind?.color}>
                        {kind && <kind.Icon />}
                      </Avatar>
                      <span className="row-main">
                        <span className="wrap">
                          {r.title}
                          {account?.paymentAmount ? ` · ${formatAmount(account.paymentAmount, account.currency)}` : ''}
                        </span>
                        <span className="muted soon wrap">{r.text}</span>
                      </span>
                      {account && (
                        <button type="button" className="chip strong" onClick={() => setPayingDebt(account)}>
                          Внести
                        </button>
                      )}
                    </li>
                  )
                })}
                {backupNote && (
                  <li className="attention">
                    <span className="avatar neutral" aria-hidden="true">
                      <ShieldIcon />
                    </span>
                    <span className="row-main">
                      <span>Резервная копия</span>
                      <span className="muted soon wrap">{backupNote}</span>
                    </span>
                    <button type="button" className="chip" onClick={() => onGo('more')}>
                      Сохранить
                    </button>
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>

        <section className="home-column">
          {advice.length > 0 && (
            <section className="card tips">
              <div className="card-head">
                <h2>Советы</h2>
                <button type="button" className="link" onClick={() => onGo('assistant')}>
                  Помощник
                </button>
              </div>
              <ul>
                {advice.map((tip) => (
                  <li key={tip.text} className={tip.level}>
                    <SparkIcon />
                    <span>{tip.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="section-head">
            <h2>Последние операции</h2>
            <button type="button" className="link" onClick={() => onGo('transactions')}>
              Все
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="empty small">Операций пока нет. Нажмите «+» внизу, чтобы добавить первую.</p>
          ) : (
            <ul className="list">
              {recent.map((t) => (
                <TxRow key={t.id} tx={t} accountById={accountById} categoryById={categoryById} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {paying && <PayForm sub={paying} accounts={accounts} categories={categories} onClose={() => setPaying(null)} />}
      {payingDebt && (
        <PaymentForm
          account={payingDebt}
          balance={balances.get(payingDebt.id) ?? 0}
          accounts={accounts}
          categories={categories}
          onClose={() => setPayingDebt(null)}
        />
      )}
    </div>
  )
}
