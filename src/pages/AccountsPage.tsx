import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { ACCOUNT_KINDS, accountLabel, isDebtKind } from '../accountKinds'
import { Avatar } from '../components/Avatar'
import { DateInput } from '../components/DateInput'
import { PlusIcon } from '../components/Icons'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { formatDate, today } from '../dates'
import {
  db,
  deleted,
  newRecord,
  touched,
  type Account,
  type AccountKind,
  type Category,
  type Data,
  type Transaction,
} from '../db'
import { amountToInput, formatAmount, formatRate, parseAmount, parseRate } from '../money'
import { graceRowText, graceToPay, isGraceDue, isPaymentDue, paymentDueText } from '../payments'
import { accountOptions, CURRENCY_OPTIONS } from '../selectOptions'
import { accountBalances, creditUsage, monthlyInterest, netWorthByCurrency } from '../stats'
import { addPeriod, daysUntil } from '../subscriptions'

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

const REMIND_OPTIONS: [number, string][] = [
  [0, 'В день платежа'],
  [1, 'За 1 день'],
  [3, 'За 3 дня'],
  [7, 'За неделю'],
]

const GRACE_REMIND_OPTIONS: [number, string][] = [
  [1, 'За 1 день'],
  [3, 'За 3 дня'],
  [7, 'За неделю'],
  [14, 'За 2 недели'],
  [30, 'За месяц'],
]

export function AccountsPage({ accounts, categories, transactions, day }: Data & { day: string }) {
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [paying, setPaying] = useState<Account | null>(null)

  const balances = useMemo(() => accountBalances(accounts, transactions), [accounts, transactions])
  const worth = useMemo(() => netWorthByCurrency(accounts, balances), [accounts, balances])
  const hasDebts = worth.some((w) => w.debts > 0)

  return (
    <>
      <div className="summary-row">
        {worth.length > 0 && (
          <div className="hero">
            <span>{hasDebts ? 'Всего с учётом долгов' : 'Всего на счетах'}</span>
            {worth.map((w) => (
              <strong key={w.currency}>{formatAmount(w.assets - w.debts, w.currency)}</strong>
            ))}
          </div>
        )}

        {worth
          .filter((w) => w.debts > 0)
          .map((w) => (
            <div key={w.currency} className="tiles">
              <div className="tile">
                <span className="muted">Свои средства</span>
                <strong className="amount income">{formatAmount(w.assets, w.currency)}</strong>
              </div>
              <div className="tile">
                <span className="muted">Долги</span>
                <strong className="amount expense">{formatAmount(w.debts, w.currency)}</strong>
              </div>
            </div>
          ))}
      </div>

      {accounts.length === 0 && <p className="empty">Счетов пока нет. Добавьте первый — например, «Наличные» или «Карта».</p>}

      <div className="groups">
        {ACCOUNT_KINDS.map(({ kind, group, icon }) => {
          const items = accounts.filter((a) => a.kind === kind)
          if (items.length === 0) return null
          // Итог группы по каждой валюте.
          const totals = new Map<string, number>()
          for (const a of items) totals.set(a.currency, (totals.get(a.currency) ?? 0) + (balances.get(a.id) ?? 0))
          return (
            <section key={kind}>
              <div className="group-head">
                <h3>
                  <span aria-hidden="true">{icon ?? '👛'}</span>
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
                        <Avatar id={a.id} label={a.name}>
                          {icon}
                        </Avatar>
                        <span className="row-main">
                          <span>{a.name}</span>
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

      <button type="button" className="fab" aria-label="Добавить счёт" onClick={() => setEditing('new')}>
        <PlusIcon />
      </button>

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

const AMOUNT_LABELS: Record<AccountKind, string> = {
  regular: 'Начальный остаток',
  savings: 'Начальный остаток',
  credit_card: 'Текущий долг по карте',
  loan: 'Остаток долга',
}

const HINTS: Partial<Record<AccountKind, string>> = {
  savings: 'Пополнение и снятие записывайте переводами между счетами, а начисленные проценты — доходом на этот счёт.',
  credit_card: 'Покупки по карте записывайте расходами с неё, а погашение долга — переводом на карту.',
  loan: 'Платёж по кредиту записывайте переводом на этот счёт, а начисленные банком проценты — расходом с него.',
}

function AccountForm({
  account,
  hasTransactions,
  onClose,
  onPay,
}: {
  account: Account | null
  hasTransactions: boolean
  onClose: () => void
  onPay: (account: Account) => void
}) {
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'regular')
  const [name, setName] = useState(account?.name ?? '')
  const [currency, setCurrency] = useState(account?.currency ?? 'RUB')
  // Для кредитов и кредитных карт в поле показываем долг положительным числом.
  const [amount, setAmount] = useState(
    account ? amountToInput(isDebtKind(account.kind) ? 0 - account.initialBalance : account.initialBalance) : '',
  )
  const [rate, setRate] = useState(account?.interestRate != null ? String(account.interestRate).replace('.', ',') : '')
  const [limit, setLimit] = useState(account?.creditLimit != null ? amountToInput(account.creditLimit) : '')
  const [target, setTarget] = useState(account?.targetAmount != null ? amountToInput(account.targetAmount) : '')
  const [graceDate, setGraceDate] = useState(account?.graceDate ?? '')
  const [graceAmount, setGraceAmount] = useState(account?.graceAmount != null ? amountToInput(account.graceAmount) : '')
  const [graceRemindDays, setGraceRemindDays] = useState(account?.graceRemindDays ?? 7)
  const [interestDebt, setInterestDebt] = useState(account?.interestDebt ? amountToInput(account.interestDebt) : '')
  const [payment, setPayment] = useState(account?.paymentAmount != null ? amountToInput(account.paymentAmount) : '')
  const [nextPayment, setNextPayment] = useState(account?.nextPaymentDate ?? '')
  const [remindDays, setRemindDays] = useState(account?.paymentRemindDays ?? 3)
  const [error, setError] = useState('')

  const hasRate = kind === 'savings' || kind === 'loan'
  const isDebt = isDebtKind(kind)

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Введите название')

    const parsedAmount = amount.trim() === '' ? 0 : parseAmount(amount)
    if (parsedAmount === null) return setError(`${AMOUNT_LABELS[kind]} — это число, например 1500,50`)

    let interestRate: number | null = null
    if (hasRate && rate.trim() !== '') {
      interestRate = parseRate(rate)
      if (interestRate === null) return setError('Ставка — это число процентов, например 16,5')
    }

    let creditLimit: number | null = null
    if (kind === 'credit_card' && limit.trim() !== '') {
      creditLimit = parseAmount(limit)
      if (creditLimit === null || creditLimit <= 0) return setError('Кредитный лимит — это число больше нуля')
    }

    let targetAmount: number | null = null
    if (kind === 'savings' && target.trim() !== '') {
      targetAmount = parseAmount(target)
      if (targetAmount === null || targetAmount <= 0) return setError('Цель — это число больше нуля')
    }

    let parsedInterestDebt = 0
    if (kind === 'credit_card' && interestDebt.trim() !== '') {
      const parsed = parseAmount(interestDebt)
      if (parsed === null || parsed < 0) return setError('Проценты в долге — это число, например 1500,50')
      parsedInterestDebt = parsed
    }

    let parsedGraceAmount: number | null = null
    if (kind === 'credit_card' && graceDate && graceAmount.trim() !== '') {
      parsedGraceAmount = parseAmount(graceAmount)
      if (parsedGraceAmount === null || parsedGraceAmount <= 0) return setError('Сумма для льготного периода — это число больше нуля')
    }
    let paymentAmount: number | null = null
    if (isDebt && payment.trim() !== '') {
      paymentAmount = parseAmount(payment)
      if (paymentAmount === null || paymentAmount <= 0) return setError('Размер платежа — это число больше нуля')
    }

    const fields = {
      name: trimmed,
      kind,
      currency,
      initialBalance: isDebt ? 0 - parsedAmount : parsedAmount,
      creditLimit,
      interestRate,
      targetAmount,
      interestDebt: parsedInterestDebt,
      graceDate: kind === 'credit_card' && graceDate ? graceDate : null,
      graceAmount: parsedGraceAmount,
      graceRemindDays,
      paymentAmount,
      nextPaymentDate: isDebt && nextPayment ? nextPayment : null,
      paymentRemindDays: remindDays,
    }
    if (account) await db.accounts.update(account.id, { ...fields, ...touched() })
    else await db.accounts.add(newRecord<Account>(fields))
    onClose()
  }

  async function remove() {
    if (!account) return
    if (hasTransactions) return setError('По счёту есть операции. Сначала удалите или перенесите их.')
    if (!confirm(`Удалить счёт «${account.name}»?`)) return
    await db.accounts.update(account.id, deleted())
    onClose()
  }

  return (
    <Modal wide title={account ? 'Счёт' : 'Новый счёт'} onClose={onClose}>
      <form onSubmit={save}>
        <label>
          Тип счёта
          {/* Смена типа перевернула бы смысл остатка (свои деньги или долг), поэтому тип задаётся один раз. */}
          <Select
            title="Тип счёта"
            value={kind}
            disabled={!!account}
            onChange={(v) => setKind(v as AccountKind)}
            options={ACCOUNT_KINDS.map((k) => ({ value: k.kind, label: k.label, icon: <Avatar>{k.icon ?? '👛'}</Avatar> }))}
          />
        </label>

        <label>
          Название
          <input autoFocus={!account} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Карта" />
        </label>

        <label>
          Валюта
          {/* Смена валюты при существующих операциях исказила бы уже введённые суммы. */}
          <Select title="Валюта" value={currency} disabled={hasTransactions} onChange={setCurrency} options={CURRENCY_OPTIONS} />
        </label>

        {kind === 'credit_card' && (
          <label>
            Кредитный лимит
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="0,00" />
          </label>
        )}

        <label>
          {AMOUNT_LABELS[kind]}
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>

        {kind === 'credit_card' && (
          <label>
            Проценты в долге, которые не занимают лимит (необязательно)
            <input inputMode="decimal" value={interestDebt} onChange={(e) => setInterestDebt(e.target.value)} placeholder="0,00" />
          </label>
        )}

        {kind === 'credit_card' && (
          <>
            <label>
              Льготный период до (без процентов)
              <DateInput value={graceDate} onChange={setGraceDate} />
            </label>
            {graceDate && (
              <>
                <label>
                  Погасить до этой даты (пусто — весь долг)
                  <input inputMode="decimal" value={graceAmount} onChange={(e) => setGraceAmount(e.target.value)} placeholder="Весь долг" />
                </label>
                <label>
                  Напомнить о конце льготного периода
                  <Select
                    title="Напомнить о конце льготного периода"
                    value={String(graceRemindDays)}
                    onChange={(v) => setGraceRemindDays(Number(v))}
                    options={GRACE_REMIND_OPTIONS.map(([days, label]) => ({ value: String(days), label }))}
                  />
                </label>
              </>
            )}
          </>
        )}

        {hasRate && (
          <label>
            Ставка, % годовых
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Например, 16,5" />
          </label>
        )}

        {kind === 'savings' && (
          <label>
            Цель накопления (необязательно)
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00" />
          </label>
        )}

        {isDebt && (
          <>
            <label>
              {kind === 'loan' ? 'Ежемесячный платёж' : 'Минимальный платёж'} (необязательно)
              <input inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="0,00" />
            </label>
            <label>
              Дата следующего платежа
              <DateInput value={nextPayment} onChange={setNextPayment} />
            </label>
            {nextPayment && (
              <label>
                Напомнить о платеже
                <Select
                  title="Напомнить о платеже"
                  value={String(remindDays)}
                  onChange={(v) => setRemindDays(Number(v))}
                  options={REMIND_OPTIONS.map(([days, label]) => ({ value: String(days), label }))}
                />
              </label>
            )}
          </>
        )}

        {HINTS[kind] && <p className="hint">{HINTS[kind]}</p>}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {account && (
            <button type="button" className="danger" onClick={remove}>
              Удалить
            </button>
          )}
          {account && isDebtKind(account.kind) && (
            <button type="button" onClick={() => onPay(account)}>
              Внести взнос
            </button>
          )}
          <button type="submit" className="primary">
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Взнос по кредиту или кредитной карте: перевод на счёт долга и новый срок следующего платежа.
 * Если взнос закрывает долг целиком, график платежей снимается.
 */
function PaymentForm({
  account,
  balance,
  accounts,
  categories,
  onClose,
}: {
  account: Account
  balance: number
  accounts: Account[]
  categories: Category[]
  onClose: () => void
}) {
  // Взнос вносят своими деньгами в той же валюте; для остального есть обычный перевод.
  const sources = accounts.filter((a) => a.id !== account.id && a.currency === account.currency && !isDebtKind(a.kind))
  const isLoan = account.kind === 'loan'
  const debt = Math.max(0, 0 - balance)
  const money = (minor: number) => formatAmount(minor, account.currency)

  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [amount, setAmount] = useState(amountToInput(account.paymentAmount ?? debt))
  const [interest, setInterest] = useState('')
  const [date, setDate] = useState(today)
  const [remind, setRemind] = useState(true)
  const [nextDate, setNextDate] = useState(() => addPeriod(account.nextPaymentDate ?? today(), 'month'))
  const [nextAmount, setNextAmount] = useState(account.paymentAmount != null ? amountToInput(account.paymentAmount) : '')
  const [newGrace, setNewGrace] = useState('')
  const [error, setError] = useState('')

  const parsed = parseAmount(amount)
  const parsedInterest = interest.trim() === '' ? 0 : parseAmount(interest)
  // Проценты по кредиту банк начисляет сверх долга, а у карты они уже сидят внутри него.
  const debtAfter = parsed !== null && parsedInterest !== null ? debt - parsed + (isLoan ? parsedInterest : 0) : null
  const closes = debtAfter !== null && debtAfter <= 0
  const showInterest = isLoan || account.interestDebt > 0
  // Льготный период: сколько осталось погасить и закрывает ли это условие текущий взнос.
  const grace = graceToPay(account, balance)
  const graceDone = grace > 0 && parsed !== null && (closes || parsed >= grace)

  async function save(e: FormEvent) {
    e.preventDefault()
    const source = sources.find((a) => a.id === sourceId)
    if (!source) return setError('Выберите счёт, с которого вносится взнос')
    if (parsed === null || parsed <= 0) return setError('Введите сумму взноса больше нуля')
    if (parsedInterest === null || parsedInterest < 0) return setError('Проценты — это число, например 1500,50')
    if (parsedInterest > parsed) return setError('Проценты не могут быть больше взноса')
    if (!date) return setError('Укажите дату взноса')
    if (isLoan && debtAfter! < 0) return setError(`Взнос больше остатка долга. Чтобы закрыть кредит, внесите ${money(debt + parsedInterest)}`)

    if (graceDone && newGrace && newGrace <= date) return setError('Новый льготный период должен заканчиваться позже этого взноса')

    let nextPaymentDate: string | null = null
    let paymentAmount = account.paymentAmount
    if (!closes && remind) {
      if (!nextDate) return setError('Укажите дату следующего платежа или отключите напоминание')
      if (nextDate <= date) return setError('Следующий платёж должен быть позже этого взноса')
      nextPaymentDate = nextDate
      if (nextAmount.trim() === '') {
        paymentAmount = null
      } else {
        paymentAmount = parseAmount(nextAmount)
        if (paymentAmount === null || paymentAmount <= 0) return setError('Размер следующего платежа — это число больше нуля')
      }
    }

    const base = { toAmount: null, date }
    await db.transaction('rw', db.accounts, db.transactions, async () => {
      await db.transactions.add(
        newRecord<Transaction>({
          ...base,
          type: 'transfer',
          amount: parsed,
          accountId: source.id,
          toAccountId: account.id,
          categoryId: null,
          note: closes ? 'Полное погашение' : 'Взнос',
        }),
      )
      // Проценты по кредиту — это расход: он возвращает в долг ту часть взноса, которая не уменьшила тело кредита.
      if (isLoan && parsedInterest > 0) {
        await db.transactions.add(
          newRecord<Transaction>({
            ...base,
            type: 'expense',
            amount: parsedInterest,
            accountId: account.id,
            toAccountId: null,
            categoryId: categories.some((c) => c.id === 'default-interest') ? 'default-interest' : null,
            note: 'Проценты',
          }),
        )
      }
      await db.accounts.update(account.id, {
        nextPaymentDate,
        paymentAmount,
        interestDebt: isLoan ? account.interestDebt : closes ? 0 : Math.max(0, account.interestDebt - parsedInterest),
        // Условие льготного периода выполнено — срок снимается или заменяется новым; иначе уменьшаем остаток.
        graceDate: grace > 0 && graceDone ? newGrace || null : account.graceDate,
        graceAmount: grace > 0 ? (graceDone || account.graceAmount == null ? null : grace - parsed) : account.graceAmount,
        ...touched(),
      })
    })
    onClose()
  }

  return (
    <Modal wide title={`Взнос: ${accountLabel(account)}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="hint">Долг сейчас: {money(debt)}</p>

        {sources.length === 0 ? (
          <p className="error">Нет счёта в валюте {account.currency}, с которого можно внести взнос.</p>
        ) : (
          <label>
            Со счёта
            <Select title="Со счёта" value={sourceId} onChange={setSourceId} options={accountOptions(sources)} />
          </label>
        )}

        <label>
          Сумма взноса, {account.currency}
          <input className="amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>

        {showInterest && (
          <label>
            {isLoan ? 'Из них проценты (необязательно)' : `Из них проценты (в долге ${money(account.interestDebt)})`}
            <input inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0,00" />
          </label>
        )}

        <div className="actions start">
          <button type="button" onClick={() => setAmount(amountToInput(debt + (isLoan ? (parsedInterest ?? 0) : 0)))}>
            Погасить полностью
          </button>
          {grace > 0 && grace < debt && (
            <button type="button" onClick={() => setAmount(amountToInput(grace))}>
              Погасить для льготного периода
            </button>
          )}
        </div>

        <label>
          Дата взноса
          <DateInput value={date} onChange={setDate} />
        </label>

        {debtAfter !== null && (
          <p className="hint">
            {closes ? 'Долг будет погашен полностью, напоминания о платежах отключатся.' : `Долг после взноса: ${money(debtAfter)}`}
          </p>
        )}

        {!closes && (
          <>
            <label className="check">
              <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
              Напомнить о следующем платеже
            </label>
            {remind && (
              <>
                <label>
                  Дата следующего платежа
                  <DateInput value={nextDate} onChange={setNextDate} />
                </label>
                <label>
                  Размер следующего платежа (необязательно)
                  <input inputMode="decimal" value={nextAmount} onChange={(e) => setNextAmount(e.target.value)} placeholder="0,00" />
                </label>
              </>
            )}
          </>
        )}

        {grace > 0 && (
          <p className="hint">
            {graceDone
              ? 'Условие льготного периода будет выполнено.'
              : `Чтобы не платить проценты, до ${formatDate(account.graceDate!)} нужно погасить ${money(grace)}.`}
          </p>
        )}

        {graceDone && !closes && (
          <label>
            Следующий льготный период до (необязательно)
            <DateInput value={newGrace} onChange={setNewGrace} />
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="submit" className="primary" disabled={sources.length === 0}>
            Внести взнос
          </button>
        </div>
      </form>
    </Modal>
  )
}
