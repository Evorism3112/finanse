import { useState, type FormEvent } from 'react'
import { ACCOUNT_KINDS, isDebtKind } from '../accountKinds'
import { Avatar } from '../components/Avatar'
import { DateInput } from '../components/DateInput'
import { ConfirmButton } from '../components/ConfirmButton'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { db, deleted, newRecord, touched, type Account, type AccountKind } from '../db'
import { amountToInput, parseAmount, parseRate } from '../money'
import { CURRENCY_OPTIONS } from '../selectOptions'

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

export function AccountForm({
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
  const [statementDay, setStatementDay] = useState(account?.statementDay != null ? String(account.statementDay) : '')
  const [favorite, setFavorite] = useState(account?.favorite ?? false)
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

    let parsedStatementDay: number | null = null
    if (kind === 'credit_card' && statementDay.trim() !== '') {
      parsedStatementDay = /^\d{1,2}$/.test(statementDay.trim()) ? Number(statementDay) : 0
      if (parsedStatementDay < 1 || parsedStatementDay > 31) return setError('День выписки — число месяца от 1 до 31')
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
      favorite,
      statementDay: parsedStatementDay,
    }
    await db.transaction('rw', db.accounts, async () => {
      // Основной счёт один: звёздочка переходит к этому счёту.
      if (favorite) {
        const others = await db.accounts.filter((a) => a.favorite && a.deletedAt === null && a.id !== account?.id).toArray()
        for (const other of others) await db.accounts.update(other.id, { favorite: false, ...touched() })
      }
      if (account) await db.accounts.update(account.id, { ...fields, ...touched() })
      else await db.accounts.add(newRecord<Account>(fields))
    })
    onClose()
  }

  async function remove() {
    if (!account) return
    if (hasTransactions) return setError('По счёту есть операции. Сначала удалите или перенесите их.')
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
            options={ACCOUNT_KINDS.map((k) => ({
              value: k.kind,
              label: k.label,
              icon: (
                <Avatar>
                  <k.Icon />
                </Avatar>
              ),
            }))}
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

        {kind === 'credit_card' && (
          <label>
            День выписки — когда банк рассчитывает обязательный платёж (число месяца, необязательно)
            <input inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} placeholder="Например, 5" />
          </label>
        )}

        {isDebt && (
          <>
            <label>
              {kind === 'loan' ? 'Ежемесячный платёж' : 'Обязательный платёж'} (необязательно)
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

        <label className="check">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          Основной счёт: выбирается первым в новых операциях
        </label>

        {HINTS[kind] && <p className="hint">{HINTS[kind]}</p>}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {account && (
            <ConfirmButton label="Удалить" onConfirm={remove} />
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
