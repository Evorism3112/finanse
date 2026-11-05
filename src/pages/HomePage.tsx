import { useMemo, useState } from 'react'
import type { Tab } from '../App'
import { CARD_COLOR, cardTotals } from '../cards'
import { Avatar } from '../components/Avatar'
import { CardIcon, ClockIcon, RepeatIcon, ShieldIcon } from '../components/Icons'
import { dayLabel } from '../dates'
import type { Account, Data, Subscription } from '../db'
import { formatAmount } from '../money'
import type { AccountReminder } from '../payments'
import { paymentSchedule, scheduleTotals, type ScheduleItem } from '../schedule'
import { daysUntil, monthlyTotals } from '../subscriptions'
import { CardForm, DebtForm } from './CardForm'
import { CardRow } from './CardsPage'
import { PaymentForm } from './PaymentForm'
import { PayForm } from './SubscriptionsPage'

/** На сколько дней вперёд показывать календарь платежей. */
const SCHEDULE_DAYS = 30

/** Когда срок: «сегодня», «через 3 дн.», «просрочено на 2 дн.». */
function whenText(date: string, today: string): string {
  const days = daysUntil(date, today)
  if (days < 0) return `просрочено на ${-days} дн.`
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  return `через ${days} дн.`
}

const KIND_TEXT: Record<ScheduleItem['kind'], string> = {
  payment: 'обязательный платёж',
  grace: 'конец льготного периода',
  subscription: 'подписка',
}

export function HomePage({
  accounts,
  subscriptions,
  balances,
  day,
  cardReminders,
  backupNote,
  onGo,
}: Data & {
  balances: Map<string, number>
  day: string
  cardReminders: AccountReminder[]
  /** Текст напоминания о резервной копии или null, если копия свежая. */
  backupNote: string | null
  onGo: (tab: Tab) => void
}) {
  const [paying, setPaying] = useState<Subscription | null>(null)
  const [payingCard, setPayingCard] = useState<Account | null>(null)
  const [editingCard, setEditingCard] = useState<Account | null>(null)
  const [updatingCard, setUpdatingCard] = useState<Account | null>(null)

  const totals = useMemo(() => cardTotals(accounts, balances), [accounts, balances])
  const monthly = useMemo(() => monthlyTotals(subscriptions), [subscriptions])
  const schedule = useMemo(() => paymentSchedule(accounts, balances, subscriptions, day, SCHEDULE_DAYS), [accounts, balances, subscriptions, day])
  const toPay = useMemo(() => scheduleTotals(schedule), [schedule])
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  // После выписки нужно не платить, а сначала указать рассчитанный банком платёж.
  const statements = cardReminders.filter((r) => r.id.endsWith(':statement'))

  if (accounts.length === 0 && subscriptions.length === 0) {
    return (
      <div className="card welcome">
        <span className="avatar accent">
          <CardIcon />
        </span>
        <h2>Добро пожаловать</h2>
        <p className="muted">
          Добавьте кредитки и подписки — приложение покажет долг и доступный лимит, напомнит об обязательном платеже, конце
          льготного периода и списаниях.
        </p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onGo('cards')}>
            Добавить кредитку
          </button>
          <button type="button" onClick={() => onGo('subscriptions')}>
            Добавить подписку
          </button>
        </div>
      </div>
    )
  }

  const list = (pairs: [string, number][]) => pairs.map(([currency, amount]) => formatAmount(amount, currency)).join(', ') || formatAmount(0, 'RUB')
  const main = totals[0]

  return (
    <div className="home">
      <section className="hero accent">
        <span>Долг по кредиткам</span>
        <strong>{main ? formatAmount(main.debt, main.currency) : formatAmount(0, 'RUB')}</strong>
        {totals.length > 1 && <span className="hero-extra">и {totals.slice(1).map((t) => formatAmount(t.debt, t.currency)).join(', ')}</span>}
        <div className="hero-tiles">
          {main && main.limit > 0 && (
            <div>
              <span>Доступно по картам</span>
              <b>{formatAmount(main.available, main.currency)}</b>
            </div>
          )}
          <div>
            <span>К оплате за {SCHEDULE_DAYS} дней</span>
            <b>{list(toPay)}</b>
          </div>
          <div>
            <span>Подписки в месяц</span>
            <b>{list(monthly)}</b>
          </div>
        </div>
      </section>

      <div className="home-columns">
        <div className="home-column">
          {(statements.length > 0 || backupNote) && (
            <section>
              <div className="section-head">
                <h2>Требует внимания</h2>
                <span className="count warn">{statements.length + (backupNote ? 1 : 0)}</span>
              </div>
              <ul className="list">
                {statements.map((r) => {
                  const account = accountById.get(r.id.split(':')[0])
                  return (
                    <li key={r.id} className="attention">
                      <Avatar id={account?.id} label={r.title} color={CARD_COLOR}>
                        <CardIcon />
                      </Avatar>
                      <span className="row-main">
                        <span className="wrap">{r.title}</span>
                        <span className="muted soon wrap">{r.text}</span>
                      </span>
                      {account && (
                        <button type="button" className="chip strong" onClick={() => setEditingCard(account)}>
                          Указать
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

          <section>
            <div className="section-head">
              <h2>Ближайшие платежи</h2>
              {schedule.some((i) => i.due) && <span className="count warn">{schedule.filter((i) => i.due).length}</span>}
            </div>
            {schedule.length === 0 ? (
              <p className="empty small">В ближайшие {SCHEDULE_DAYS} дней платить ничего не нужно.</p>
            ) : (
              <ul className="list">
                {schedule.map((item) => {
                  const isSub = item.kind === 'subscription'
                  const name = isSub ? item.subscription.name : item.account.name
                  const status = item.due ? (daysUntil(item.date, day) < 0 ? ' overdue' : ' soon') : ''
                  return (
                    <li key={item.id} className="attention">
                      {isSub ? (
                        <Avatar id={item.subscription.id} label={name}>
                          <RepeatIcon />
                        </Avatar>
                      ) : (
                        <Avatar id={item.account.id} label={name} color={CARD_COLOR}>
                          {item.kind === 'grace' ? <ClockIcon /> : <CardIcon />}
                        </Avatar>
                      )}
                      <span className="row-main">
                        <span className="wrap">
                          {name}
                          {item.amount !== null && ` · ${item.kind === 'grace' ? 'погасить ' : ''}${formatAmount(item.amount, item.currency)}`}
                        </span>
                        <span className={`muted wrap${status}`}>
                          {KIND_TEXT[item.kind]} · {whenText(item.date, day)} · {dayLabel(item.date)}
                        </span>
                      </span>
                      {isSub ? (
                        <button type="button" className="chip" onClick={() => setPaying(item.subscription)}>
                          Оплачено
                        </button>
                      ) : (
                        <button type="button" className={item.due ? 'chip strong' : 'chip'} onClick={() => setPayingCard(item.account)}>
                          Внести
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="home-column">
          <div>
            <div className="section-head">
              <h2>Кредитки</h2>
              <button type="button" className="link" onClick={() => onGo('cards')}>
                Все
              </button>
            </div>
            {accounts.length === 0 ? (
              <p className="empty small">Кредиток пока нет.</p>
            ) : (
              <ul className="list">
                {accounts.map((a) => (
                  <CardRow
                    key={a.id}
                    account={a}
                    balance={balances.get(a.id) ?? 0}
                    day={day}
                    onEdit={() => setEditingCard(a)}
                    onPay={() => setPayingCard(a)}
                    onDebt={() => setUpdatingCard(a)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {paying && <PayForm sub={paying} cards={accounts} onClose={() => setPaying(null)} />}
      {editingCard && (
        <CardForm
          account={editingCard}
          balance={balances.get(editingCard.id) ?? 0}
          onClose={() => setEditingCard(null)}
          onPay={(account) => {
            setEditingCard(null)
            setPayingCard(account)
          }}
        />
      )}
      {payingCard && <PaymentForm account={payingCard} balance={balances.get(payingCard.id) ?? 0} onClose={() => setPayingCard(null)} />}
      {updatingCard && <DebtForm account={updatingCard} balance={balances.get(updatingCard.id) ?? 0} onClose={() => setUpdatingCard(null)} />}
    </div>
  )
}
