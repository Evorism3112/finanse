import { useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CARD_COLOR, cardDebt, cardTotals } from '../cards'
import { Avatar } from '../components/Avatar'
import { CardIcon, PlusIcon } from '../components/Icons'
import { formatDate } from '../dates'
import { type Account, type Data } from '../db'
import { formatAmount } from '../money'
import { graceRowText, graceToPay, isGraceDue, isPaymentDue, paymentDueText, statementState, statementText } from '../payments'
import { creditUsage } from '../stats'
import { daysUntil } from '../subscriptions'
import { CardForm, DebtForm } from './CardForm'
import { PaymentForm } from './PaymentForm'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Строка кредитки: долг, лимит, сроки и быстрые действия. */
export function CardRow({
  account: a,
  balance,
  day,
  onEdit,
  onPay,
  onDebt,
}: {
  account: Account
  balance: number
  day: string
  onEdit: () => void
  onPay: () => void
  onDebt: () => void
}) {
  const money = (minor: number) => formatAmount(minor, a.currency)
  const debt = cardDebt(balance)
  const statement = statementState(a, balance, day)
  let progress: number | null = null
  let limitText = 'лимит не указан'
  if (a.creditLimit) {
    const { used, available } = creditUsage(a.creditLimit, balance, a.interestDebt)
    progress = clamp01(used / a.creditLimit)
    limitText = `доступно ${money(available)} из ${money(a.creditLimit)}`
    if (a.interestDebt > 0 && debt > 0) limitText += ` · проценты ${money(Math.min(a.interestDebt, debt))}`
  }

  return (
    <li>
      <button type="button" className="row" onClick={onEdit}>
        <Avatar id={a.id} label={a.name} color={CARD_COLOR}>
          <CardIcon />
        </Avatar>
        <span className="row-main">
          <span className="name">{a.name}</span>
          <span className="muted wrap">{limitText}</span>
          {a.nextPaymentDate != null && debt > 0 && (
            <span className={`muted wrap${isPaymentDue(a, balance, day) ? (daysUntil(a.nextPaymentDate, day) < 0 ? ' overdue' : ' soon') : ''}`}>
              {paymentDueText(a.nextPaymentDate, day)} · {formatDate(a.nextPaymentDate)}
              {a.paymentAmount ? ` · ${money(a.paymentAmount)}` : ''}
            </span>
          )}
          {statement && <span className={`muted wrap${statement.kind === 'calculated' ? ' soon' : ''}`}>{statementText(statement, day)}</span>}
          {graceToPay(a, balance) > 0 && (
            <span className={`muted wrap${isGraceDue(a, balance, day) ? (daysUntil(a.graceDate!, day) < 0 ? ' overdue' : ' soon') : ''}`}>
              {graceRowText(a, balance, day)}
            </span>
          )}
          {progress !== null && (
            <span className="bar">
              <span
                className="usage"
                style={
                  {
                    width: `${progress * 100}%`,
                    // Градиент растянут на всю шкалу, заполненная часть открывает его начало.
                    '--full': `${100 / Math.max(progress, 0.01)}%`,
                  } as CSSProperties
                }
              />
            </span>
          )}
        </span>
        <span className={debt > 0 ? 'amount expense' : 'amount'}>{debt > 0 ? `−${money(debt)}` : 'нет долга'}</span>
      </button>
      <div className="row-actions">
        <button type="button" className="chip" onClick={onDebt}>
          Обновить долг
        </button>
        {debt > 0 && (
          <button type="button" className="chip" onClick={onPay}>
            Внести взнос
          </button>
        )}
      </div>
    </li>
  )
}

export function CardsPage({
  accounts,
  balances,
  day,
  headerSlot,
}: Data & { balances: Map<string, number>; day: string; headerSlot: HTMLElement | null }) {
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [paying, setPaying] = useState<Account | null>(null)
  const [updating, setUpdating] = useState<Account | null>(null)

  const totals = useMemo(() => cardTotals(accounts, balances), [accounts, balances])
  // Ближайшие сроки — первыми, карты без долга — в конце.
  const sorted = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        const dueA = cardDebt(balances.get(a.id) ?? 0) > 0 ? (a.nextPaymentDate ?? '9999') : '~'
        const dueB = cardDebt(balances.get(b.id) ?? 0) > 0 ? (b.nextPaymentDate ?? '9999') : '~'
        return dueA.localeCompare(dueB) || a.name.localeCompare(b.name, 'ru')
      }),
    [accounts, balances],
  )

  return (
    <>
      <div className="split">
        {/* Итоги — сверху на телефоне, справа на широком экране. */}
        <aside className="split-side">
          {totals.map((t) => (
            <section key={t.currency} className="hero">
              <span>Долг по кредиткам</span>
              <strong>{formatAmount(t.debt, t.currency)}</strong>
              {t.limit > 0 && (
                <div className="hero-split">
                  <div>
                    <span className="muted">Доступно</span>
                    <b>{formatAmount(t.available, t.currency)}</b>
                  </div>
                  <div>
                    <span className="muted">Общий лимит</span>
                    <b>{formatAmount(t.limit, t.currency)}</b>
                  </div>
                </div>
              )}
            </section>
          ))}
        </aside>

        <div className="split-main">
          {accounts.length === 0 && (
            <p className="empty">Кредиток пока нет. Добавьте первую — приложение напомнит о платеже и конце льготного периода.</p>
          )}
          {accounts.length > 0 && (
            <ul className="list">
              {sorted.map((a) => (
                <CardRow
                  key={a.id}
                  account={a}
                  balance={balances.get(a.id) ?? 0}
                  day={day}
                  onEdit={() => setEditing(a)}
                  onPay={() => setPaying(a)}
                  onDebt={() => setUpdating(a)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {headerSlot &&
        createPortal(
          <button type="button" className="header-btn" aria-label="Добавить кредитку" onClick={() => setEditing('new')}>
            <PlusIcon />
            Кредитка
          </button>,
          headerSlot,
        )}

      {editing && (
        <CardForm
          account={editing === 'new' ? null : editing}
          balance={editing === 'new' ? 0 : (balances.get(editing.id) ?? 0)}
          onClose={() => setEditing(null)}
          onPay={(account) => {
            setEditing(null)
            setPaying(account)
          }}
        />
      )}
      {paying && <PaymentForm account={paying} balance={balances.get(paying.id) ?? 0} onClose={() => setPaying(null)} />}
      {updating && <DebtForm account={updating} balance={balances.get(updating.id) ?? 0} onClose={() => setUpdating(null)} />}
    </>
  )
}
