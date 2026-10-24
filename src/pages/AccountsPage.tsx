import { useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ACCOUNT_KINDS, isDebtKind } from '../accountKinds'
import { Avatar } from '../components/Avatar'
import { PlusIcon, StarIcon } from '../components/Icons'
import { formatDate } from '../dates'
import { type Account, type Data } from '../db'
import { formatAmount, formatRate } from '../money'
import { graceRowText, graceToPay, isGraceDue, isPaymentDue, paymentDueText } from '../payments'
import { accountBalances, creditUsage, monthlyInterest, netWorthByCurrency } from '../stats'
import { daysUntil } from '../subscriptions'
import { AccountForm } from './AccountForm'
import { PaymentForm } from './PaymentForm'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Подпись и шкала под названием счёта: ставка, цель, доступный лимит, доля погашения. */
function describe(a: Account, balance: number): { sub: string; progress: number | null; usage: boolean } {
  const money = (minor: number) => formatAmount(minor, a.currency)
  const parts: string[] = []
  let progress: number | null = null
  // Шкала кредитной карты показывает занятую часть лимита и окрашена от зелёного к красному.
  let usage = false

  if (a.kind === 'savings') {
    if (a.interestRate) {
      parts.push(`${formatRate(a.interestRate)} годовых`)
      if (balance > 0) parts.push(`≈ +${money(monthlyInterest(balance, a.interestRate))} в мес.`)
    }
    if (a.targetAmount) {
      progress = clamp01(balance / a.targetAmount)
      parts.push(`цель ${money(a.targetAmount)}`)
    }
  } else if (a.kind === 'credit_card') {
    if (a.creditLimit) {
      const { used, available } = creditUsage(a.creditLimit, balance, a.interestDebt)
      progress = clamp01(used / a.creditLimit)
      usage = true
      parts.push(`Доступно ${money(available)} из ${money(a.creditLimit)}`)
      if (a.interestDebt > 0 && balance < 0) parts.push(`проценты ${money(Math.min(a.interestDebt, 0 - balance))}`)
    }
  } else if (a.kind === 'loan') {
    if (a.initialBalance < 0) {
      progress = clamp01(1 - balance / a.initialBalance)
      parts.push(`Погашено ${Math.round(progress * 100)} %`)
    }
    if (a.interestRate) {
      parts.push(`${formatRate(a.interestRate)} годовых`)
      if (balance < 0) parts.push(`≈ ${money(monthlyInterest(balance, a.interestRate))} процентов в мес.`)
    }
  }

  return { sub: parts.join(' · ') || a.currency, progress, usage }
}

export function AccountsPage({
  accounts,
  categories,
  transactions,
  day,
  headerSlot,
}: Data & { day: string; headerSlot: HTMLElement | null }) {
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [paying, setPaying] = useState<Account | null>(null)

  const balances = useMemo(() => accountBalances(accounts, transactions), [accounts, transactions])
  const worth = useMemo(() => netWorthByCurrency(accounts, balances), [accounts, balances])

  return (
    <>
      {worth.map((w) => (
          <section key={w.currency} className="hero">
            <span>{w.debts > 0 ? 'Капитал с учётом долгов' : 'Всего на счетах'}</span>
            <strong>{formatAmount(w.assets - w.debts, w.currency)}</strong>
            {w.debts > 0 && (
              <>
                <div className="stack-bar" aria-hidden="true">
                  <span style={{ flexGrow: w.assets, background: 'var(--accent)' }} />
                  <span style={{ flexGrow: w.debts, background: 'var(--expense)' }} />
                </div>
                <div className="hero-split">
                  <div>
                    <span className="muted">
                      <span className="swatch" style={{ background: 'var(--accent)' }} />
                      Свои средства
                    </span>
                    <b>{formatAmount(w.assets, w.currency)}</b>
                  </div>
                  <div>
                    <span className="muted">
                      <span className="swatch" style={{ background: 'var(--expense)' }} />
                      Долги
                    </span>
                    <b>{formatAmount(w.debts, w.currency)}</b>
                  </div>
                </div>
              </>
            )}
          </section>
      ))}

      {accounts.length === 0 && <p className="empty">Счетов пока нет. Добавьте первый — например, «Наличные» или «Карта».</p>}

      <div className="groups">
        {ACCOUNT_KINDS.map(({ kind, group, Icon, color }) => {
          const items = accounts.filter((a) => a.kind === kind)
          if (items.length === 0) return null
          // Итог группы по каждой валюте.
          const totals = new Map<string, number>()
          for (const a of items) totals.set(a.currency, (totals.get(a.currency) ?? 0) + (balances.get(a.id) ?? 0))
          return (
            <section key={kind}>
              <div className="group-head">
                <h3>
                  <Icon />
                  {group}
                  <span className="count">{items.length}</span>
                </h3>
                <span className="group-total">
                  {[...totals].map(([currency, total]) => (
                    <span key={currency} className={total < 0 ? 'amount expense' : 'amount'}>
                      {formatAmount(total, currency)}
                    </span>
                  ))}
                </span>
              </div>
              <ul className="list">
                {items.map((a) => {
                  const balance = balances.get(a.id) ?? 0
                  const { sub, progress, usage } = describe(a, balance)
                  return (
                    <li key={a.id}>
                      <button type="button" className="row" onClick={() => setEditing(a)}>
                        <Avatar id={a.id} label={a.name} color={color}>
                          <Icon />
                        </Avatar>
                        <span className="row-main">
                          <span className="name">
                            {a.name}
                            {a.favorite && (
                              <span className="star" title="Основной счёт">
                                <StarIcon />
                              </span>
                            )}
                          </span>
                          <span className="muted wrap">{sub}</span>
                          {graceToPay(a, balance) > 0 && (
                            <span className={`muted wrap${isGraceDue(a, balance, day) ? (daysUntil(a.graceDate!, day) < 0 ? ' overdue' : ' soon') : ''}`}>
                              {graceRowText(a, balance, day)}
                            </span>
                          )}
                          {a.nextPaymentDate != null && balance < 0 && (
                            <span
                              className={`muted wrap${isPaymentDue(a, balance, day) ? (daysUntil(a.nextPaymentDate, day) < 0 ? ' overdue' : ' soon') : ''}`}
                            >
                              {paymentDueText(a.nextPaymentDate, day)} · {formatDate(a.nextPaymentDate)}
                              {a.paymentAmount ? ` · ${formatAmount(a.paymentAmount, a.currency)}` : ''}
                            </span>
                          )}
                          {progress !== null && (
                            <span className="bar">
                              <span
                                className={usage ? 'usage' : 'accent'}
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
                        <span className={balance < 0 ? 'amount expense' : 'amount'}>{formatAmount(balance, a.currency)}</span>
                      </button>
                      {isDebtKind(a.kind) && balance < 0 && (
                        <div className="row-actions">
                          <button type="button" className="chip" onClick={() => setPaying(a)}>
                            Внести взнос
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      {headerSlot &&
        createPortal(
          <button type="button" className="header-btn" aria-label="Добавить счёт" onClick={() => setEditing('new')}>
            <PlusIcon />
            Счёт
          </button>,
          headerSlot,
        )}

      {editing && (
        <AccountForm
          account={editing === 'new' ? null : editing}
          hasTransactions={
            editing !== 'new' && transactions.some((t) => t.accountId === editing.id || t.toAccountId === editing.id)
          }
          onClose={() => setEditing(null)}
          onPay={(account) => {
            setEditing(null)
            setPaying(account)
          }}
        />
      )}

      {paying && (
        <PaymentForm
          account={paying}
          balance={balances.get(paying.id) ?? 0}
          accounts={accounts}
          categories={categories}
          onClose={() => setPaying(null)}
        />
      )}
    </>
  )
}
