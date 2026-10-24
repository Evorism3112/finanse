import { useMemo, useState } from 'react'
import { accountLabel } from '../accountKinds'
import { SearchIcon } from '../components/Icons'
import { Select } from '../components/Select'
import { MonthNav } from '../components/MonthNav'
import { TxRow } from '../components/TxRow'
import { currentMonth, dayLabel, formatDate } from '../dates'
import type { Data, Transaction, TxType } from '../db'
import { amountToInput, formatAmount } from '../money'
import { accountOptions } from '../selectOptions'
import { monthReport } from '../stats'

const TYPE_FILTERS: [TxType | '', string][] = [
  ['', 'Все'],
  ['expense', 'Расходы'],
  ['income', 'Доходы'],
  ['transfer', 'Переводы'],
]

export function TransactionsPage({ accounts, categories, transactions, onOpen }: Data & { onOpen: (tx: Transaction) => void }) {
  const [month, setMonth] = useState(currentMonth)
  const [query, setQuery] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<TxType | ''>('')

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const search = query.trim().toLowerCase()

  // Без поиска показываем выбранный месяц, а поиск идёт по всем месяцам сразу.
  const visible = useMemo(
    () =>
      transactions.filter((t) => {
        if (accountFilter && t.accountId !== accountFilter && t.toAccountId !== accountFilter) return false
        if (typeFilter && t.type !== typeFilter) return false
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
    [transactions, accountFilter, typeFilter, search, month, accountById, categoryById],
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

  // Итог дня по каждой валюте: доходы минус расходы, переводы не считаются.
  const dayTotal = (items: Transaction[]) => {
    const totals = new Map<string, number>()
    for (const t of items) {
      if (t.type === 'transfer') continue
      const currency = accountById.get(t.accountId)?.currency ?? 'RUB'
      totals.set(currency, (totals.get(currency) ?? 0) + (t.type === 'income' ? t.amount : -t.amount))
    }
    return [...totals]
      .filter(([, total]) => total !== 0)
      .map(([currency, total]) => (total > 0 ? '+' : '−') + formatAmount(Math.abs(total), currency))
      .join(' · ')
  }

  return (
    <div className="split">
      <aside className="split-side">
        <div className="filters">
          <label className="search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по всем месяцам"
              aria-label="Поиск по операциям"
            />
          </label>
          <div className="pills" role="group" aria-label="Тип операций">
            {TYPE_FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={typeFilter === value ? 'pill active' : 'pill'}
                aria-pressed={typeFilter === value}
                onClick={() => setTypeFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
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
          <p className="empty">{search || accountFilter || typeFilter ? 'Ничего не найдено.' : 'За этот месяц операций нет.'}</p>
        )}

        {days.map(([date, items]) => (
          <section key={date}>
            <div className="group-title">
              <h3>{dayLabel(date)}</h3>
              <span>{dayTotal(items)}</span>
            </div>
            <ul className="list">
              {items.map((t) => (
                <TxRow key={t.id} tx={t} accountById={accountById} categoryById={categoryById} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
