import { useMemo, useState, type FormEvent } from 'react'
import { accountLabel } from '../accountKinds'
import { Avatar } from '../components/Avatar'
import { DateInput } from '../components/DateInput'
import { PlusIcon, TransferIcon } from '../components/Icons'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { MonthNav } from '../components/MonthNav'
import { currentMonth, dayLabel, formatDate, today } from '../dates'
import { db, deleted, newRecord, touched, type Account, type Category, type Data, type Transaction, type TxType } from '../db'
import { amountToInput, formatAmount, parseAmount } from '../money'
import { accountOptions, categoryOptions } from '../selectOptions'
import { monthReport } from '../stats'

const TYPE_LABELS: [TxType, string][] = [
  ['expense', 'Расход'],
  ['income', 'Доход'],
  ['transfer', 'Перевод'],
]

export function TransactionsPage({ accounts, categories, transactions }: Data) {
  const [month, setMonth] = useState(currentMonth)
  const [query, setQuery] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null)

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const search = query.trim().toLowerCase()

  // Без поиска показываем выбранный месяц, а поиск идёт по всем месяцам сразу.
  const visible = useMemo(
    () =>
      transactions.filter((t) => {
        if (accountFilter && t.accountId !== accountFilter && t.toAccountId !== accountFilter) return false
        if (!search) return t.date.startsWith(month)
        const account = accountById.get(t.accountId)
        const toAccount = t.toAccountId ? accountById.get(t.toAccountId) : undefined
        const title = t.type === 'transfer' ? 'Перевод' : ((t.categoryId && categoryById.get(t.categoryId)?.name) ?? 'Без категории')
        return [t.note, title, account && accountLabel(account), toAccount && accountLabel(toAccount), amountToInput(t.amount), formatDate(t.date)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search)
      }),
    [transactions, accountFilter, search, month, accountById, categoryById],
  )

  const days = useMemo(() => {
    const sorted = [...visible].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    const groups: [string, Transaction[]][] = []
    for (const t of sorted) {
      const last = groups[groups.length - 1]
      if (last && last[0] === t.date) last[1].push(t)
      else groups.push([t.date, [t]])
    }
    return groups
  }, [visible])

  // Пустой месяц в monthReport подходит под любую дату: при поиске итог считается по всему найденному.
  const summary = useMemo(() => monthReport(accounts, visible, search ? '' : month), [accounts, visible, search, month])

  if (accounts.length === 0) {
    return <p className="empty">Сначала добавьте счёт на вкладке «Счета».</p>
  }

  return (
    <>
      <div className="split">
        <aside className="split-side">
          <div className="filters">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: комментарий, категория, сумма"
              aria-label="Поиск по операциям"
            />
            {accounts.length > 1 && (
              <Select
                title="Счёт"
                value={accountFilter}
                onChange={setAccountFilter}
                options={[{ value: '', label: 'Все счета' }, ...accountOptions(accounts)]}
              />
            )}
          </div>

          {search ? (
            <p className="hint found">Поиск по всем месяцам, найдено операций: {visible.length}</p>
          ) : (
            <MonthNav month={month} onChange={setMonth} />
          )}

          {summary.map((r) => (
            <div key={r.currency} className="tiles">
              <div className="tile">
                <span className="muted">Доходы</span>
                <strong className="amount income">+{formatAmount(r.income, r.currency)}</strong>
              </div>
              <div className="tile">
                <span className="muted">Расходы</span>
                <strong className="amount expense">−{formatAmount(r.expense, r.currency)}</strong>
              </div>
            </div>
          ))}
        </aside>

        <div className="split-main">
          {days.length === 0 && (
            <p className="empty">{search || accountFilter ? 'Ничего не найдено.' : 'За этот месяц операций нет.'}</p>
          )}

          {days.map(([date, items]) => (
            <section key={date}>
              <h3 className="group-title">{dayLabel(date)}</h3>
              <ul className="list">
                {items.map((t) => {
                  const account = accountById.get(t.accountId)
                  const toAccount = t.toAccountId ? accountById.get(t.toAccountId) : undefined
                  const category = t.categoryId ? categoryById.get(t.categoryId) : undefined
                  const title = t.type === 'transfer' ? 'Перевод' : (category?.name ?? 'Без категории')
                  const nameOf = (a: Account | undefined) => (a ? accountLabel(a) : '?')
                  const sub = t.type === 'transfer' ? `${nameOf(account)} → ${nameOf(toAccount)}` : account && nameOf(account)
                  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''
                  return (
                    <li key={t.id}>
                      <button type="button" className="row" onClick={() => setEditing(t)}>
                        {t.type === 'transfer' ? (
                          <Avatar>
                            <TransferIcon />
                          </Avatar>
                        ) : (
                          <Avatar id={category?.id} label={category?.name} />
                        )}
                        <span className="row-main">
                          <span>{title}</span>
                          <span className="muted">{[sub, t.note].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className={`amount ${t.type}`}>
                          {sign}
                          {formatAmount(t.amount, account?.currency ?? 'RUB')}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <button type="button" className="fab" aria-label="Добавить операцию" onClick={() => setEditing('new')}>
        <PlusIcon />
      </button>

      {editing && (
        <TxForm
          tx={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function TxForm({
  tx,
  accounts,
  categories,
  onClose,
}: {
  tx: Transaction | null
  accounts: Account[]
  categories: Category[]
  onClose: () => void
}) {
  const [type, setType] = useState<TxType>(tx?.type ?? 'expense')
  const [amount, setAmount] = useState(tx ? amountToInput(tx.amount) : '')
  const [accountId, setAccountId] = useState(tx?.accountId ?? accounts[0].id)
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId ?? '')
  const [toAmount, setToAmount] = useState(tx?.toAmount != null ? amountToInput(tx.toAmount) : '')
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? '')
  const [date, setDate] = useState(tx?.date ?? today())
  const [note, setNote] = useState(tx?.note ?? '')
  const [error, setError] = useState('')

  const account = accounts.find((a) => a.id === accountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const kindCategories = categories.filter((c) => c.kind === type)
  const differentCurrencies = type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency

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
      categoryId: type !== 'transfer' && kindCategories.some((c) => c.id === categoryId) ? categoryId : null,
      date,
      note: note.trim(),
    }
    if (tx) await db.transactions.update(tx.id, { ...fields, ...touched() })
    else await db.transactions.add(newRecord<Transaction>(fields))
    onClose()
  }

  async function remove() {
    if (!tx || !confirm('Удалить операцию?')) return
    await db.transactions.update(tx.id, deleted())
    onClose()
  }

  return (
    <Modal wide title={tx ? 'Операция' : 'Новая операция'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="segmented">
          {TYPE_LABELS.map(([value, label]) => (
            <button key={value} type="button" className={type === value ? 'active' : ''} onClick={() => setType(value)}>
              {label}
            </button>
          ))}
        </div>

        <label>
          Сумма{account ? `, ${account.currency}` : ''}
          <input className="amount-input" inputMode="decimal" autoFocus={!tx} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>

        <label>
          {type === 'transfer' ? 'Со счёта' : 'Счёт'}
          <Select title={type === 'transfer' ? 'Со счёта' : 'Счёт'} value={accountId} onChange={setAccountId} options={accountOptions(accounts)} />
        </label>

        {type === 'transfer' ? (
          <>
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
          </>
        ) : (
          <label>
            Категория
            <Select title="Категория" value={categoryId} onChange={setCategoryId} options={categoryOptions(kindCategories)} />
          </label>
        )}

        <label>
          Дата
          <DateInput value={date} onChange={setDate} />
        </label>

        <label>
          Комментарий
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {tx && (
            <button type="button" className="danger" onClick={remove}>
              Удалить
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
