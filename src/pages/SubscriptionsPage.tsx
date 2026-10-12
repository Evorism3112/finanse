import { Fragment, useMemo, useState, type FormEvent } from 'react'
import { accountLabel } from '../accountKinds'
import { Avatar } from '../components/Avatar'
import { DateInput } from '../components/DateInput'
import { BellIcon, PlusIcon } from '../components/Icons'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { formatDate, today } from '../dates'
import {
  db,
  deleted,
  newRecord,
  touched,
  type Account,
  type Category,
  type CategoryKind,
  type Data,
  type Installment,
  type Period,
  type Subscription,
} from '../db'
import { amountToInput, formatAmount, parseAmount } from '../money'
import { notifyState, requestNotifications } from '../notify'
import { accountOptions, categoryOptions, CURRENCY_OPTIONS } from '../selectOptions'
import { paySubscription } from '../subscriptionActions'
import {
  addPeriod,
  daysUntil,
  dueText,
  installmentAt,
  installmentsTotal,
  isDue,
  monthlyTotals,
  PERIODS,
  upcomingInstallment,
} from '../subscriptions'

const REMIND_OPTIONS: [number, string][] = [
  [0, 'В день платежа'],
  [1, 'За 1 день'],
  [3, 'За 3 дня'],
  [7, 'За неделю'],
  [14, 'За 2 недели'],
]

const DIRECTIONS: [CategoryKind, string][] = [
  ['expense', 'Расход'],
  ['income', 'Доход'],
]

/** На сколько выплат в месяц можно разбить регулярный доход. */
const MAX_PARTS = 5

const shortPeriod = (period: Period) => PERIODS.find((p) => p.period === period)!.short

export function SubscriptionsPage({ accounts, categories, subscriptions, day }: Data & { day: string }) {
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null)
  const [permission, setPermission] = useState(notifyState)

  const sorted = useMemo(
    () => [...subscriptions].sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name, 'ru')),
    [subscriptions],
  )
  const expenses = useMemo(() => monthlyTotals(subscriptions.filter((s) => s.direction === 'expense')), [subscriptions])
  const incomes = useMemo(() => monthlyTotals(subscriptions.filter((s) => s.direction === 'income')), [subscriptions])

  /** Отметка прямо из списка: счёт и категория могли быть удалены после создания записи. */
  function payNow(s: Subscription) {
    void paySubscription({
      ...s,
      accountId: accounts.some((a) => a.id === s.accountId) ? s.accountId : null,
      categoryId: categories.some((c) => c.id === s.categoryId) ? s.categoryId : null,
    })
  }

  return (
    <>
      <div className="split">
        <aside className="split-side">
          {expenses.length > 0 && (
            <div className="hero">
              <span>Регулярные расходы в месяц</span>
              {expenses.map(([currency, total]) => (
                <strong key={currency}>{formatAmount(total, currency)}</strong>
              ))}
            </div>
          )}

          {incomes.length > 0 && (
            <div className="tiles one">
              <div className="tile">
                <span className="muted">Регулярные доходы в месяц</span>
                {incomes.map(([currency, total]) => (
                  <strong key={currency} className="amount income">
                    +{formatAmount(total, currency)}
                  </strong>
                ))}
              </div>
            </div>
          )}

          {subscriptions.length > 0 && permission === 'default' && (
            <div className="card notice">
              <BellIcon />
              <span>Включите уведомления, чтобы получать напоминания о платежах.</span>
              <button type="button" className="primary" onClick={async () => setPermission(await requestNotifications())}>
                Включить
              </button>
            </div>
          )}
        </aside>

        <div className="split-main">
          {subscriptions.length === 0 && (
            <p className="empty">
              Здесь живут подписки, аренда, зарплата и всё, что повторяется. Добавьте запись — приложение напомнит о сроке.
            </p>
          )}

          {sorted.length > 0 && (
            <ul className="list">
              {sorted.map((s) => {
                const due = isDue(s, day)
                return (
                  <li key={s.id}>
                    <button type="button" className="row" onClick={() => setEditing(s)}>
                      <Avatar id={s.id} label={s.name} />
                      <span className="row-main">
                        <span>{s.name}</span>
                        <span className={`muted wrap${due ? (daysUntil(s.nextDate, day) < 0 ? ' overdue' : ' soon') : ''}`}>
                          {dueText(s, day)} · {formatDate(s.nextDate)}
                        </span>
                      </span>
                      <span className={s.direction === 'income' ? 'amount income' : 'amount'}>
                        {s.direction === 'income' ? '+' : ''}
                        {formatAmount(s.amount, s.currency)}
                        <span className="muted">
                          {s.installments?.length
                            ? ` из ${formatAmount(installmentsTotal(s.installments), s.currency)} в мес.`
                            : ` / ${shortPeriod(s.period)}`}
                        </span>
                      </span>
                    </button>
                    {due && (
                      <div className="row-actions">
                        <button type="button" className="chip" onClick={() => payNow(s)}>
                          {s.direction === 'income' ? 'Получено' : 'Оплачено'}
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <button type="button" className="fab" aria-label="Добавить регулярный платёж" onClick={() => setEditing('new')}>
        <PlusIcon />
      </button>

      {editing && (
        <SubscriptionForm
          sub={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function SubscriptionForm({
  sub,
  accounts,
  categories,
  onClose,
}: {
  sub: Subscription | null
  accounts: Account[]
  categories: Category[]
  onClose: () => void
}) {
  const [direction, setDirection] = useState<CategoryKind>(sub?.direction ?? 'expense')
  const [name, setName] = useState(sub?.name ?? '')
  const [amount, setAmount] = useState(sub ? amountToInput(sub.amount) : '')
  const [period, setPeriod] = useState<Period>(sub?.period ?? 'month')
  const [nextDate, setNextDate] = useState(sub?.nextDate ?? addPeriod(today(), 'month'))
  const [autoRenew, setAutoRenew] = useState(sub?.autoRenew ?? true)
  const [accountId, setAccountId] = useState(sub ? (sub.accountId ?? '') : (accounts[0]?.id ?? ''))
  const [currency, setCurrency] = useState(sub?.currency ?? 'RUB')
  const [categoryId, setCategoryId] = useState(sub ? (sub.categoryId ?? '') : 'default-subscriptions')
  const [remindDays, setRemindDays] = useState(sub?.remindDays ?? 3)
  const [note, setNote] = useState(sub?.note ?? '')
  // Выплаты, на которые делится месячный доход; пустой список — приходит одной суммой.
  const [parts, setParts] = useState<{ day: string; amount: string }[]>(
    () => sub?.installments?.map((p) => ({ day: String(p.day), amount: amountToInput(p.amount) })) ?? [],
  )
  const [error, setError] = useState('')

  const isIncome = direction === 'income'
  const canSplit = isIncome && period === 'month'
  const split = canSplit && parts.length > 1
  const partsTotal = parts.reduce((sum, p) => sum + (parseAmount(p.amount) ?? 0), 0)

  function setPartCount(count: number) {
    if (count <= 1) return setParts([])
    setParts((current) => {
      // Первая строка наследует то, что уже введено одной суммой.
      const base = current.length > 0 ? current : [{ day: nextDate ? String(Number(nextDate.slice(8))) : '', amount }]
      return Array.from({ length: count }, (_, i) => base[i] ?? { day: '', amount: '' })
    })
  }

  const setPart = (index: number, change: Partial<{ day: string; amount: string }>) =>
    setParts((current) => current.map((p, i) => (i === index ? { ...p, ...change } : p)))
  const account = accounts.find((a) => a.id === accountId)
  const kindCategories = categories.filter((c) => c.kind === direction)

  function switchDirection(value: CategoryKind) {
    setDirection(value)
    // Категории доходов и расходов разные, прежний выбор к новому типу не подходит.
    setCategoryId(value === 'expense' ? 'default-subscriptions' : 'default-salary')
  }

  /** Проверяет форму и возвращает поля записи или null, если есть ошибка. */
  function readFields() {
    const trimmed = name.trim()
    if (!trimmed) return setError('Введите название'), null
    let installments: Installment[] | null = null
    let parsed: number | null
    let date = nextDate
    if (split) {
      installments = []
      for (const [i, part] of parts.entries()) {
        const day = /^\d{1,2}$/.test(part.day.trim()) ? Number(part.day) : 0
        if (day < 1 || day > 31) return setError(`Выплата ${i + 1}: число месяца — от 1 до 31`), null
        const partAmount = parseAmount(part.amount)
        if (partAmount === null || partAmount <= 0) return setError(`Выплата ${i + 1}: введите сумму больше нуля`), null
        if (installments.some((p) => p.day === day)) return setError(`Выплата ${i + 1}: это число месяца уже занято другой выплатой`), null
        installments.push({ day, amount: partAmount })
      }
      installments.sort((a, b) => a.day - b.day)
      // Ещё не отмеченную выплату не теряем: дата остаётся, если на неё по-прежнему приходится выплата.
      const pending = sub ? installmentAt(installments, sub.nextDate) : undefined
      const nearest = pending ? { date: sub!.nextDate, amount: pending.amount } : upcomingInstallment(installments, today())
      parsed = nearest.amount
      date = nearest.date
    } else {
      parsed = parseAmount(amount)
      if (parsed === null || parsed <= 0) return setError('Введите сумму больше нуля'), null
      if (!date) return setError('Укажите дату'), null
    }
    return {
      direction,
      name: trimmed,
      amount: parsed,
      installments,
      // Если запись привязана к счёту, она считается в его валюте.
      currency: account?.currency ?? currency,
      period,
      nextDate: date,
      // У дохода нет «срока действия»: он просто повторяется.
      autoRenew: isIncome ? true : autoRenew,
      accountId: account?.id ?? null,
      categoryId: kindCategories.some((c) => c.id === categoryId) ? categoryId : null,
      remindDays,
      note: note.trim(),
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const fields = readFields()
    if (!fields) return
    if (sub) await db.subscriptions.update(sub.id, { ...fields, ...touched() })
    else await db.subscriptions.add(newRecord<Subscription>(fields))
    onClose()
  }

  async function pay() {
    const fields = readFields()
    if (!sub || !fields) return
    await paySubscription({ ...sub, ...fields })
    onClose()
  }

  async function remove() {
    if (!sub || !confirm(`Удалить «${sub.name}»?`)) return
    await db.subscriptions.update(sub.id, deleted())
    onClose()
  }

  const dateLabel = isIncome ? 'Следующее поступление' : autoRenew ? 'Следующее списание' : 'Оплачена до'
  const doneLabel = isIncome ? 'Получено' : 'Оплачено'

  return (
    <Modal wide title={sub ? 'Регулярный платёж' : 'Новый регулярный платёж'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="segmented">
          {DIRECTIONS.map(([value, label]) => (
            <button key={value} type="button" className={direction === value ? 'active' : ''} onClick={() => switchDirection(value)}>
              {label}
            </button>
          ))}
        </div>

        <label>
          Название
          <input
            autoFocus={!sub}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isIncome ? 'Например, Зарплата' : 'Например, Музыка'}
          />
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

        {canSplit && (
          <label>
            Выплат в месяц
            <Select
              title="Выплат в месяц"
              value={String(Math.max(1, parts.length))}
              onChange={(v) => setPartCount(Number(v))}
              options={Array.from({ length: MAX_PARTS }, (_, i) => ({
                value: String(i + 1),
                label: i === 0 ? 'Одна — всей суммой' : String(i + 1),
              }))}
            />
          </label>
        )}

        {split ? (
          <>
            <p className="hint">
              Например, аванс и основная часть. Напоминание и отметка «Получено» работают по каждой выплате отдельно.
            </p>
            {parts.map((part, i) => (
              <Fragment key={i}>
                <label>
                  Выплата {i + 1} — число месяца
                  <input inputMode="numeric" value={part.day} onChange={(e) => setPart(i, { day: e.target.value })} placeholder="1–31" />
                </label>
                <label>
                  Выплата {i + 1} — сумма, {account?.currency ?? currency}
                  <input inputMode="decimal" value={part.amount} onChange={(e) => setPart(i, { amount: e.target.value })} placeholder="0,00" />
                </label>
              </Fragment>
            ))}
            <p className="hint">Итого в месяц: {formatAmount(partsTotal, account?.currency ?? currency)}</p>
          </>
        ) : (
          <>
            <label>
              {isIncome ? 'Сумма' : 'Стоимость'}, {account?.currency ?? currency}
              <input className="amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </label>

            <label>
              {dateLabel}
              <DateInput value={nextDate} onChange={setNextDate} />
            </label>
          </>
        )}

        <label>
          Напомнить
          <Select
            title="Напомнить"
            value={String(remindDays)}
            onChange={(v) => setRemindDays(Number(v))}
            options={REMIND_OPTIONS.map(([days, label]) => ({ value: String(days), label }))}
          />
        </label>

        {!isIncome && (
          <label className="check">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
            Продлевается автоматически
          </label>
        )}

        <label>
          {isIncome ? 'Счёт зачисления' : 'Счёт для оплаты'}
          <Select
            title={isIncome ? 'Счёт зачисления' : 'Счёт для оплаты'}
            value={account ? accountId : ''}
            onChange={setAccountId}
            options={[{ value: '', label: 'Не привязывать к счёту', icon: <Avatar label="—" /> }, ...accountOptions(accounts)]}
          />
        </label>

        {account ? (
          <label>
            Категория
            <Select title="Категория" value={categoryId} onChange={setCategoryId} options={categoryOptions(kindCategories)} />
          </label>
        ) : (
          <label>
            Валюта
            <Select title="Валюта" value={currency} onChange={setCurrency} options={CURRENCY_OPTIONS} />
          </label>
        )}

        <label>
          Комментарий
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {sub && (
          <p className="hint">
            «{doneLabel}» переносит дату на следующий период
            {account ? ` и записывает ${isIncome ? 'доход' : 'расход'}: ${accountLabel(account)}.` : '.'}
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {sub && (
            <>
              <button type="button" className="danger" onClick={remove}>
                Удалить
              </button>
              <button type="button" onClick={pay}>
                {doneLabel}
              </button>
            </>
          )}
          <button type="submit" className="primary">
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  )
}
