import { useState, type FormEvent } from 'react'
import { cardDebt, paymentRecord } from '../cards'
import { DateInput } from '../components/DateInput'
import { Modal } from '../components/Modal'
import { addDays, formatDate, today } from '../dates'
import { db, touched, type Account } from '../db'
import { amountToInput, formatAmount, parseAmount } from '../money'
import { graceToPay, nextStatementDate } from '../payments'
import { addPeriod } from '../subscriptions'

/**
 * Взнос по кредитке: уменьшает долг и переносит срок следующего платежа.
 * Если взнос закрывает долг целиком, напоминания о платежах снимаются.
 */
export function PaymentForm({ account, balance, onClose }: { account: Account; balance: number; onClose: () => void }) {
  const debt = cardDebt(balance)
  const money = (minor: number) => formatAmount(minor, account.currency)

  const [amount, setAmount] = useState(amountToInput(account.paymentAmount != null ? Math.min(account.paymentAmount, debt) : debt))
  const [interest, setInterest] = useState('')
  const [date, setDate] = useState(today)
  // У карты с днём выписки следующий платёж станет известен только после выписки: приложение само напомнит его указать.
  const waitsStatement = account.statementDay != null
  const [remind, setRemind] = useState(!waitsStatement)
  const [nextDate, setNextDate] = useState(() => addPeriod(account.nextPaymentDate ?? today(), 'month'))
  const [nextAmount, setNextAmount] = useState(account.paymentAmount != null ? amountToInput(account.paymentAmount) : '')
  const [newGrace, setNewGrace] = useState('')
  const [error, setError] = useState('')

  const parsed = parseAmount(amount)
  const parsedInterest = interest.trim() === '' ? 0 : parseAmount(interest)
  const debtAfter = parsed !== null ? debt - parsed : null
  const closes = debtAfter !== null && debtAfter <= 0
  const showInterest = account.interestDebt > 0
  // Льготный период: сколько осталось погасить и закрывает ли это условие текущий взнос.
  const grace = graceToPay(account, balance)
  const graceDone = grace > 0 && parsed !== null && (closes || parsed >= grace)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || parsed <= 0) return setError('Введите сумму взноса больше нуля')
    if (parsedInterest === null || parsedInterest < 0) return setError('Проценты — это число, например 1500,50')
    if (parsedInterest > parsed) return setError('Проценты не могут быть больше взноса')
    if (!date) return setError('Укажите дату взноса')
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

    await db.transaction('rw', db.accounts, db.transactions, async () => {
      await db.transactions.add(paymentRecord(account, parsed, date, closes ? 'Полное погашение' : 'Взнос'))
      await db.accounts.update(account.id, {
        nextPaymentDate,
        paymentAmount,
        interestDebt: closes ? 0 : Math.max(0, account.interestDebt - parsedInterest),
        // Условие льготного периода выполнено — срок снимается или заменяется новым; иначе уменьшаем остаток.
        graceDate: grace > 0 && graceDone ? newGrace || null : account.graceDate,
        graceAmount: grace > 0 ? (graceDone || account.graceAmount == null ? null : grace - parsed) : account.graceAmount,
        ...touched(),
      })
    })
    onClose()
  }

  return (
    <Modal wide title={`Взнос: ${account.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="hint">Долг сейчас: {money(debt)}</p>

        <label>
          Сумма взноса, {account.currency}
          <input className="amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>

        {showInterest && (
          <label>
            Из них проценты (в долге {money(account.interestDebt)})
            <input inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0,00" />
          </label>
        )}

        <div className="actions start">
          <button type="button" onClick={() => setAmount(amountToInput(debt))}>
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
            {!remind && waitsStatement && (
              <p className="hint">
                Следующий обязательный платёж банк рассчитает {formatDate(nextStatementDate(account.statementDay!, addDays(date || today(), 1)))} — приложение напомнит
                его указать.
              </p>
            )}
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
          <button type="submit" className="primary">
            Внести взнос
          </button>
        </div>
      </form>
    </Modal>
  )
}
