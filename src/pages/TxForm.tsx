import { useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { defaultAccount } from '../accountKinds'
import { Avatar } from '../components/Avatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { Calendar } from '../components/DateInput'
import { BackspaceIcon, CalendarIcon, CloseIcon, SwapIcon } from '../components/Icons'
import { Select } from '../components/Select'
import { addDays, formatDate, today } from '../dates'
import { db, deleted, newRecord, touched, type Account, type Category, type Synced, type Transaction, type TxType } from '../db'
import { amountToInput, currencySymbol, parseAmount, typeAmount } from '../money'
import { accountOptions } from '../selectOptions'
import { useEscape } from '../useEscape'

const TYPE_LABELS: [TxType, string, string][] = [
  ['expense', 'Расход', 'расход'],
  ['income', 'Доход', 'доход'],
  ['transfer', 'Перевод', 'перевод'],
]

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back']

/**
 * Быстрый ввод операции. На телефоне сумма набирается своей клавиатурой, системная не всплывает и не закрывает форму;
 * с мышью и клавиатурой сумму просто печатают в поле.
 */
export function TxForm({
  tx,
  draft,
  accounts,
  categories,
  transactions,
  onClose,
  onSaved,
}: {
  tx: Transaction | null
  /** Заполненная заранее новая операция, например из помощника. */
  draft?: Omit<Transaction, keyof Synced>
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  onClose: () => void
  /** Новая операция записана; передаётся её id. */
  onSaved?: (id: string) => void
}) {
  const init = tx ?? draft
  const [type, setType] = useState<TxType>(init?.type ?? 'expense')
  const [amount, setAmount] = useState(init ? typeAmount(amountToInput(init.amount)) : '')
  const [accountId, setAccountId] = useState(init?.accountId ?? defaultAccount(accounts)!.id)
  const [toAccountId, setToAccountId] = useState(init?.toAccountId ?? '')
  const [toAmount, setToAmount] = useState(init?.toAmount != null ? amountToInput(init.toAmount) : '')
  const [categoryId, setCategoryId] = useState(init?.categoryId ?? '')
  const [date, setDate] = useState(init?.date ?? today())
  const [note, setNote] = useState(init?.note ?? '')
  const [calendar, setCalendar] = useState(false)
  const [error, setError] = useState('')
  const [touch] = useState(() => matchMedia('(pointer: coarse)').matches)

  useEscape(onClose)

  const account = accounts.find((a) => a.id === accountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const differentCurrencies = type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency

  // Плитки категорий: сначала те, которыми пользуются чаще, чтобы нужная была под пальцем.
  const kindCategories = useMemo(() => {
    const uses = new Map<string, number>()
    for (const t of transactions) if (t.categoryId) uses.set(t.categoryId, (uses.get(t.categoryId) ?? 0) + 1)
    return categories
      .filter((c) => c.kind === type)
      .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'ru'))
  }, [categories, transactions, type])
  const category = kindCategories.find((c) => c.id === categoryId)

  const now = today()
  const yesterday = addDays(now, -1)
  const verb = TYPE_LABELS.find(([value]) => value === type)![2]

  function press(key: string) {
    setError('')
    const raw = amount.replace(/ /g, '')
    setAmount(typeAmount(key === 'back' ? raw.slice(0, -1) : raw + key))
  }

  function swap() {
    if (!toAccount) return
    setAccountId(toAccount.id)
    setToAccountId(accountId)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (parsed === null || parsed <= 0) return setError('Введите сумму больше нуля')
    if (!account) return setError('Выберите счёт')
    if (!date) return setError('Укажите дату')

    let parsedTo: number | null = null
    if (type === 'transfer') {
      if (!toAccount) return setError('Выберите счёт зачисления')
      if (toAccount.id === account.id) return setError('Счета перевода должны различаться')
      if (differentCurrencies) {
        parsedTo = parseAmount(toAmount)
        if (parsedTo === null || parsedTo <= 0) return setError('Введите сумму зачисления')
      }
    }

    const fields = {
      type,
      amount: parsed,
      accountId: account.id,
      toAccountId: type === 'transfer' ? toAccount!.id : null,
      toAmount: parsedTo,
      categoryId: type !== 'transfer' && category ? category.id : null,
      date,
      note: note.trim(),
    }
    if (tx) await db.transactions.update(tx.id, { ...fields, ...touched() })
    else {
      const record = newRecord<Transaction>(fields)
      await db.transactions.add(record)
      onSaved?.(record.id)
    }
    onClose()
  }

  async function remove() {
    if (!tx) return
    await db.transactions.update(tx.id, deleted())
    onClose()
  }

  const dateChip = (value: string, label: string) => (
    <button type="button" className={date === value ? 'pill active' : 'pill'} aria-pressed={date === value} onClick={() => setDate(value)}>
      {label}
    </button>
  )

  return (
    <>
      <div className="overlay quick-overlay" onClick={onClose}>
        <div className="modal quick" role="dialog" aria-label={tx ? 'Операция' : 'Новая операция'} onClick={(e) => e.stopPropagation()}>
          <form onSubmit={save}>
            <div className="quick-head">
              <button type="button" className="icon-btn boxed" aria-label="Закрыть" onClick={onClose}>
                <CloseIcon />
              </button>
              <div className="segmented" role="radiogroup" aria-label="Тип операции">
                {TYPE_LABELS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={type === value}
                    className={type === value ? 'active' : ''}
                    onClick={() => setType(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
  
            <label className={`quick-amount ${type}`}>
              <span className="quick-caption">
                Сумма{type === 'transfer' ? ' перевода' : category ? ` · ${category.name}` : ''}
              </span>
              <span className="quick-value">
                {type === 'income' && amount && <span aria-hidden="true">+</span>}
                <input
                  inputMode={touch ? 'none' : 'decimal'}
                  autoFocus={!tx && !touch}
                  value={amount}
                  onChange={(e) => {
                    setError('')
                    setAmount(typeAmount(e.target.value))
                  }}
                  placeholder="0"
                  size={Math.max(1, amount.length)}
                />
                <span aria-hidden="true">{currencySymbol(account?.currency ?? 'RUB')}</span>
              </span>
            </label>
  
            {type === 'transfer' ? (
              <div className="transfer-pair">
                <label>
                  Со счёта
                  <Select title="Со счёта" value={accountId} onChange={setAccountId} options={accountOptions(accounts)} />
                </label>
                <button type="button" className="swap" aria-label="Поменять счета местами" disabled={!toAccount} onClick={swap}>
                  <SwapIcon />
                </button>
                <label>
                  На счёт
                  <Select
                    title="На счёт"
                    value={toAccountId}
                    onChange={setToAccountId}
                    placeholder="Выберите счёт"
                    options={accountOptions(accounts.filter((a) => a.id !== accountId))}
                  />
                </label>
                {differentCurrencies && (
                  <label>
                    Сумма зачисления, {toAccount!.currency}
                    <input inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} placeholder="0,00" />
                  </label>
                )}
              </div>
            ) : null}
  
            <div className="pills">
              {type !== 'transfer' && (
                <label className="pill-select">
                  <span className="visually-hidden">Счёт</span>
                  <Select title="Счёт" value={accountId} onChange={setAccountId} options={accountOptions(accounts)} />
                </label>
              )}
              {dateChip(now, 'Сегодня')}
              {dateChip(yesterday, 'Вчера')}
              <button
                type="button"
                className={date !== now && date !== yesterday ? 'pill active' : 'pill'}
                aria-label="Выбрать дату"
                onClick={() => setCalendar(true)}
              >
                <CalendarIcon />
                {date !== now && date !== yesterday && formatDate(date)}
              </button>
            </div>
  
            {type !== 'transfer' && (
              <div className="cat-grid" role="radiogroup" aria-label="Категория">
                {kindCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={c.id === categoryId}
                    className={c.id === categoryId ? 'cat-tile active' : 'cat-tile'}
                    // Повторное нажатие снимает выбор: операция останется без категории.
                    onClick={() => setCategoryId(c.id === categoryId ? '' : c.id)}
                  >
                    <Avatar id={c.id} label={c.name} />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            )}
  
            <label className="note-field">
              <span className="visually-hidden">Комментарий</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий" />
            </label>
  
            {error && <p className="error">{error}</p>}
  
            {touch && (
              <div className="keypad">
                {KEYS.map((key) => (
                  <button key={key} type="button" aria-label={key === 'back' ? 'Стереть' : key} onClick={() => press(key)}>
                    {key === 'back' ? <BackspaceIcon /> : key}
                  </button>
                ))}
              </div>
            )}
  
            <div className="actions">
              {tx && <ConfirmButton label="Удалить" onConfirm={remove} />}
              <button type="submit" className="primary">
                {tx ? 'Сохранить' : `Добавить ${verb}`}
              </button>
            </div>
          </form>
        </div>
      </div>

      {calendar &&
        createPortal(
          <Calendar
            value={date}
            onClose={() => setCalendar(false)}
            onPick={(picked) => {
              setCalendar(false)
              setDate(picked)
            }}
          />,
          document.body,
        )}
    </>
  )
}
