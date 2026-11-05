import { useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CARD_COLOR } from '../cards'
import { Avatar } from '../components/Avatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { DateInput } from '../components/DateInput'
import { BellIcon, CardIcon, PlusIcon } from '../components/Icons'
import { Modal } from '../components/Modal'
import { Select, type SelectOption } from '../components/Select'
import { formatDate, today } from '../dates'
import { db, deleted, newRecord, touched, type Account, type Data, type Period, type Subscription } from '../db'
import { amountToInput, formatAmount, parseAmount } from '../money'
import { notifyState, requestNotifications } from '../notify'
import { CURRENCY_OPTIONS } from '../selectOptions'
import { paySubscription } from '../subscriptionActions'
import { addPeriod, advanceSubscription, daysUntil, dueText, isDue, monthlyCost, monthlyTotals, PERIODS } from '../subscriptions'

const REMIND_OPTIONS: [number, string][] = [
  [0, 'В день платежа'],
  [1, 'За 1 день'],
  [3, 'За 3 дня'],
  [7, 'За неделю'],
  [14, 'За 2 недели'],
]

const shortPeriod = (period: Period) => PERIODS.find((p) => p.period === period)!.short

/** Кредитки для выбора; первым — вариант без карты. */
function cardOptions(cards: Account[], none: string): SelectOption[] {
  return [
    { value: '', label: none, icon: <Avatar label="—" /> },
    ...[...cards]
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.currency,
        icon: (
          <Avatar id={a.id} label={a.name} color={CARD_COLOR}>
            <CardIcon />
          </Avatar>
        ),
      })),
  ]
}

export function SubscriptionsPage({ accounts, subscriptions, day, headerSlot }: Data & { day: string; headerSlot: HTMLElement | null }) {
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null)
  const [paying, setPaying] = useState<Subscription | null>(null)
  const [permission, setPermission] = useState(notifyState)

  const sorted = useMemo(
    () => [...subscriptions].sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name, 'ru')),
    [subscriptions],
  )
  const totals = useMemo(() => monthlyTotals(subscriptions), [subscriptions])
  const cardById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  return (
    <>
      <div className="split">
        {/* Итоги — сверху на телефоне, справа на широком экране. */}
        <aside className="split-side">
          {totals.length > 0 && (
            <div className="hero">
              <span>Подписки в месяц</span>
              {totals.map(([currency, total]) => (
                <strong key={currency}>{formatAmount(total, currency)}</strong>
              ))}
              <span className="hero-extra">
                в год ≈ {totals.map(([currency, total]) => formatAmount(total * 12, currency)).join(', ')}
              </span>
            </div>
          )}

          {subscriptions.length > 0 && permission === 'default' && (
            <div className="card notice">
              <BellIcon />
              <span>Включите уведомления, чтобы получать напоминания о списаниях.</span>
              <button type="button" className="primary" onClick={async () => setPermission(await requestNotifications())}>
                Включить
              </button>
            </div>
          )}
        </aside>

        <div className="split-main">
          {subscriptions.length === 0 && (
            <p className="empty">Подписок пока нет. Добавьте первую — приложение напомнит о списании или о конце оплаченного срока.</p>
          )}

          {sorted.length > 0 && (
            <ul className="list">
              {sorted.map((s) => {
                const due = isDue(s, day)
                const card = s.accountId ? cardById.get(s.accountId) : undefined
                return (
                  <li key={s.id}>
                    <button type="button" className="row" onClick={() => setEditing(s)}>
                      <Avatar id={s.id} label={s.name} />
                      <span className="row-main">
                        <span>{s.name}</span>
                        <span className={`muted wrap${due ? (daysUntil(s.nextDate, day) < 0 ? ' overdue' : ' soon') : ''}`}>
                          {dueText(s, day)} · {formatDate(s.nextDate)}
                          {card ? ` · ${card.name}` : ''}
                        </span>
                      </span>
                      <span className="amount per">
                        {formatAmount(s.amount, s.currency)}
                        <span className="muted"> / {shortPeriod(s.period)}</span>
                      </span>
                    </button>
                    <div className="row-actions">
                      <button type="button" className="chip" onClick={() => setPaying(s)}>
                        Оплачено
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {headerSlot &&
        createPortal(
          <button type="button" className="header-btn" aria-label="Добавить подписку" onClick={() => setEditing('new')}>
            <PlusIcon />
            Подписка
          </button>,
          headerSlot,
        )}

      {editing && <SubscriptionForm sub={editing === 'new' ? null : editing} cards={accounts} onClose={() => setEditing(null)} />}

      {paying && <PayForm sub={paying} cards={accounts} onClose={() => setPaying(null)} />}
    </>
  )
}

function SubscriptionForm({ sub, cards, onClose }: { sub: Subscription | null; cards: Account[]; onClose: () => void }) {
  const [name, setName] = useState(sub?.name ?? '')
  const [amount, setAmount] = useState(sub ? amountToInput(sub.amount) : '')
  const [period, setPeriod] = useState<Period>(sub?.period ?? 'month')
  const [nextDate, setNextDate] = useState(sub?.nextDate ?? addPeriod(today(), 'month'))
  const [autoRenew, setAutoRenew] = useState(sub?.autoRenew ?? true)
  const [accountId, setAccountId] = useState(sub?.accountId ?? '')
  const [currency, setCurrency] = useState(sub?.currency ?? 'RUB')
  const [remindDays, setRemindDays] = useState(sub?.remindDays ?? 3)
  const [note, setNote] = useState(sub?.note ?? '')
  const [error, setError] = useState('')

  const card = cards.find((a) => a.id === accountId)
  const shownCurrency = card?.currency ?? currency
  const parsed = parseAmount(amount)

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Введите название')
    if (parsed === null || parsed <= 0) return setError('Введите сумму больше нуля')
    if (!nextDate) return setError('Укажите дату')
    const fields = {
      direction: 'expense' as const,
      name: trimmed,
      amount: parsed,
      installments: null,
      // Подписка, привязанная к карте, считается в её валюте.
      currency: shownCurrency,
      period,
      nextDate,
      autoRenew,
      accountId: card?.id ?? null,
      categoryId: sub?.categoryId ?? 'default-subscriptions',
      remindDays,
      note: note.trim(),
    }
    if (sub) await db.subscriptions.update(sub.id, { ...fields, ...touched() })
    else await db.subscriptions.add(newRecord<Subscription>(fields))
    onClose()
  }

  async function remove() {
    if (!sub) return
    await db.subscriptions.update(sub.id, deleted())
    onClose()
  }

  return (
    <Modal wide title={sub ? 'Подписка' : 'Новая подписка'} onClose={onClose}>
      <form onSubmit={save}>
        <label>
          Название
          <input autoFocus={!sub} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Музыка" />
        </label>

        <label>
          Стоимость, {shownCurrency}
          <input className="amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>

        <label>
          Периодичность
          <Select
            title="Периодичность"
            value={period}
            onChange={(v) => setPeriod(v as Period)}
            options={PERIODS.map((p) => ({ value: p.period, label: p.label }))}
          />
        </label>

        <label>
          {autoRenew ? 'Следующее списание' : 'Оплачена до'}
          <DateInput value={nextDate} onChange={setNextDate} />
        </label>

        <label>
          Напомнить
          <Select
            title="Напомнить"
            value={String(remindDays)}
            onChange={(v) => setRemindDays(Number(v))}
            options={REMIND_OPTIONS.map(([days, label]) => ({ value: String(days), label }))}
          />
        </label>

        <label>
          Списывается с кредитки
          <Select title="Списывается с кредитки" value={card ? accountId : ''} onChange={setAccountId} options={cardOptions(cards, 'Не с кредитки')} />
        </label>

        {!card && (
          <label>
            Валюта
            <Select title="Валюта" value={currency} onChange={setCurrency} options={CURRENCY_OPTIONS} />
          </label>
        )}

        <label>
          Комментарий
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <label className="check">
          <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
          Продлевается автоматически
        </label>

        {parsed !== null && parsed > 0 && period !== 'month' && (
          <p className="hint">В пересчёте на месяц: {formatAmount(monthlyCost(parsed, period), shownCurrency)}.</p>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {sub && <ConfirmButton label="Удалить" onConfirm={remove} />}
          <button type="submit" className="primary">
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Отметка «Оплачено»: переносит срок на следующий период. Если подписка списалась с кредитки,
 * её сумма добавляется к долгу карты. Фактическая сумма может отличаться от плановой — её можно поправить.
 */
export function PayForm({ sub, cards, onClose }: { sub: Subscription; cards: Account[]; onClose: () => void }) {
  // Списание ведётся в валюте подписки, поэтому подходят только карты в ней.
  const usable = cards.filter((a) => a.currency === sub.currency)
  const money = (minor: number) => formatAmount(minor, sub.currency)

  const [amount, setAmount] = useState(amountToInput(sub.amount))
  const [date, setDate] = useState(today)
  const [accountId, setAccountId] = useState(usable.some((a) => a.id === sub.accountId) ? sub.accountId! : '')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')

  const parsed = parseAmount(amount)
  const changed = parsed !== null && parsed > 0 && parsed !== sub.amount
  const next = advanceSubscription(sub, parsed ?? sub.amount, remember && changed)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || parsed <= 0) return setError('Введите сумму больше нуля')
    if (!date) return setError('Укажите дату')
    await paySubscription(sub, { amount: parsed, date, accountId: accountId || null, remember: remember && changed })
    onClose()
  }

  return (
    <Modal title={`Оплачено: ${sub.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <label>
          Сколько списали, {sub.currency}
          <input className="amount-input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>

        {changed && (
          <>
            <p className="hint">По плану было {money(sub.amount)}.</p>
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Запомнить новую сумму как плановую
            </label>
          </>
        )}

        <label>
          Дата
          <DateInput value={date} onChange={setDate} />
        </label>

        {usable.length > 0 && (
          <label>
            Списано с кредитки
            <Select title="Списано с кредитки" value={accountId} onChange={setAccountId} options={cardOptions(usable, 'Не с кредитки')} />
          </label>
        )}

        <p className="hint">
          {accountId ? 'Сумма добавится к долгу карты. ' : ''}
          Следующий платёж: {formatDate(next.nextDate)}, {money(next.amount)}.
        </p>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="submit" className="primary">
            Оплачено
          </button>
        </div>
      </form>
    </Modal>
  )
}
