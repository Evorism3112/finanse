import { useState, type FormEvent } from 'react'
import { accountLabel, defaultAccount, isDebtKind } from '../accountKinds'
import { DateInput } from '../components/DateInput'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { formatDate, today } from '../dates'
import { db, newRecord, touched, type Account, type Category, type Transaction } from '../db'
import { amountToInput, formatAmount, parseAmount } from '../money'
import { graceToPay } from '../payments'
import { accountOptions } from '../selectOptions'
import { addPeriod } from '../subscriptions'

/**
 * Взнос по кредиту или кредитной карте: перевод на счёт долга и новый срок следующего платежа.
 * Если взнос закрывает долг целиком, график платежей снимается.
 */
export function PaymentForm({
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

  const [sourceId, setSourceId] = useState(defaultAccount(sources)?.id ?? '')
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
