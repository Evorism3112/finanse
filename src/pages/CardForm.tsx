import { useState, type FormEvent } from 'react'
import { cardDebt, deleteCard, initialBalanceForDebt, setCardDebt } from '../cards'
import { ConfirmButton } from '../components/ConfirmButton'
import { DateInput } from '../components/DateInput'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { db, newRecord, touched, type Account } from '../db'
import { amountToInput, parseAmount } from '../money'
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

/** Новая кредитка или её настройки: лимит, долг, льготный период и обязательный платёж. */
export function CardForm({
  account,
  balance,
  onClose,
  onPay,
}: {
  account: Account | null
  /** Текущий остаток карты; у новой — 0. */
  balance: number
  onClose: () => void
  onPay: (account: Account) => void
}) {
  const [name, setName] = useState(account?.name ?? '')
  const [currency, setCurrency] = useState(account?.currency ?? 'RUB')
  const [limit, setLimit] = useState(account?.creditLimit != null ? amountToInput(account.creditLimit) : '')
  const [debt, setDebt] = useState(account ? amountToInput(cardDebt(balance)) : '')
  const [interestDebt, setInterestDebt] = useState(account?.interestDebt ? amountToInput(account.interestDebt) : '')
  const [graceDate, setGraceDate] = useState(account?.graceDate ?? '')
  const [graceAmount, setGraceAmount] = useState(account?.graceAmount != null ? amountToInput(account.graceAmount) : '')
  const [graceRemindDays, setGraceRemindDays] = useState(account?.graceRemindDays ?? 7)
  const [payment, setPayment] = useState(account?.paymentAmount != null ? amountToInput(account.paymentAmount) : '')
  const [nextPayment, setNextPayment] = useState(account?.nextPaymentDate ?? '')
  const [remindDays, setRemindDays] = useState(account?.paymentRemindDays ?? 3)
  const [statementDay, setStatementDay] = useState(account?.statementDay != null ? String(account.statementDay) : '')
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Введите название')

    const parsedDebt = debt.trim() === '' ? 0 : parseAmount(debt)
    if (parsedDebt === null || parsedDebt < 0) return setError('Долг — это число, например 15000,50')

    let creditLimit: number | null = null
    if (limit.trim() !== '') {
      creditLimit = parseAmount(limit)
      if (creditLimit === null || creditLimit <= 0) return setError('Кредитный лимит — это число больше нуля')
    }

    let parsedInterestDebt = 0
    if (interestDebt.trim() !== '') {
      const parsed = parseAmount(interestDebt)
      if (parsed === null || parsed < 0) return setError('Проценты в долге — это число, например 1500,50')
      parsedInterestDebt = parsed
    }

    let parsedGraceAmount: number | null = null
    if (graceDate && graceAmount.trim() !== '') {
      parsedGraceAmount = parseAmount(graceAmount)
      if (parsedGraceAmount === null || parsedGraceAmount <= 0) return setError('Сумма для льготного периода — это число больше нуля')
    }

    let paymentAmount: number | null = null
    if (payment.trim() !== '') {
      paymentAmount = parseAmount(payment)
      if (paymentAmount === null || paymentAmount <= 0) return setError('Обязательный платёж — это число больше нуля')
    }

    let parsedStatementDay: number | null = null
    if (statementDay.trim() !== '') {
      parsedStatementDay = /^\d{1,2}$/.test(statementDay.trim()) ? Number(statementDay) : 0
      if (parsedStatementDay < 1 || parsedStatementDay > 31) return setError('День выписки — число месяца от 1 до 31')
    }

    const fields = {
      name: trimmed,
      currency,
      creditLimit,
      interestDebt: parsedInterestDebt,
      graceDate: graceDate || null,
      graceAmount: parsedGraceAmount,
      graceRemindDays,
      paymentAmount,
      nextPaymentDate: nextPayment || null,
      paymentRemindDays: remindDays,
      statementDay: parsedStatementDay,
    }
    if (account) {
      // Долг правят только если его поменяли: иначе мелкие расхождения из прошлых версий остались бы как есть.
      const debtChanged = parsedDebt !== cardDebt(balance)
      await db.accounts.update(account.id, {
        ...fields,
        ...(debtChanged ? { initialBalance: initialBalanceForDebt(account, balance, parsedDebt) } : {}),
        ...touched(),
      })
    } else {
      await db.accounts.add(
        newRecord<Account>({
          ...fields,
          kind: 'credit_card',
          initialBalance: 0 - parsedDebt,
          interestRate: null,
          targetAmount: null,
          favorite: false,
        }),
      )
    }
    onClose()
  }

  async function remove() {
    if (!account) return
    await deleteCard(account)
    onClose()
  }

  return (
    <Modal wide title={account ? 'Кредитка' : 'Новая кредитка'} onClose={onClose}>
      <form onSubmit={save}>
        <label>
          Название
          <input autoFocus={!account} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Сбер" />
        </label>

        <label>
          Валюта
          <Select title="Валюта" value={currency} disabled={!!account} onChange={setCurrency} options={CURRENCY_OPTIONS} />
        </label>

        <label>
          Кредитный лимит
          <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="0,00" />
        </label>

        <label>
          Долг сейчас
          <input inputMode="decimal" value={debt} onChange={(e) => setDebt(e.target.value)} placeholder="0,00" />
        </label>

        <label>
          Проценты в долге, которые не занимают лимит (необязательно)
          <input inputMode="decimal" value={interestDebt} onChange={(e) => setInterestDebt(e.target.value)} placeholder="0,00" />
        </label>

        <label>
          День выписки — когда банк рассчитывает обязательный платёж (число месяца, необязательно)
          <input inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} placeholder="Например, 5" />
        </label>

        <label>
          Обязательный платёж (необязательно)
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

        <p className="hint">Покупки по карте вести не нужно: когда долг изменится, просто укажите новый — как в приложении банка.</p>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {account && <ConfirmButton label="Удалить" onConfirm={remove} />}
          {account && cardDebt(balance) > 0 && (
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

/** Быстрое обновление долга прямо из строки карты, без захода в настройки. */
export function DebtForm({ account, balance, onClose }: { account: Account; balance: number; onClose: () => void }) {
  const [debt, setDebt] = useState(amountToInput(cardDebt(balance)))
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    const parsed = debt.trim() === '' ? 0 : parseAmount(debt)
    if (parsed === null || parsed < 0) return setError('Долг — это число, например 15000,50')
    await setCardDebt(account, balance, parsed)
    onClose()
  }

  return (
    <Modal title={`Долг: ${account.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <label>
          Долг сейчас, {account.currency}
          <input className="amount-input" inputMode="decimal" autoFocus value={debt} onChange={(e) => setDebt(e.target.value)} placeholder="0,00" />
        </label>
        <p className="hint">Посмотрите задолженность в приложении банка и впишите её сюда.</p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary">
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  )
}
