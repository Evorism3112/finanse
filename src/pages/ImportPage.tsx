import { useMemo, useState, type ChangeEvent } from 'react'
import { accountLabel, defaultAccount, pickingOrder } from '../accountKinds'
import { Avatar } from '../components/Avatar'
import { TransferIcon, UploadIcon } from '../components/Icons'
import { Select, type SelectOption } from '../components/Select'
import { formatDate } from '../dates'
import { db, newRecord, type Data, type Transaction } from '../db'
import { formatAmount } from '../money'
import { accountOptions, categoryOptions } from '../selectOptions'
import type { Statement } from '../statement'
import { readStatementFile } from '../statementFiles'
import { merchantKey, prepareImport, type ImportItem } from '../statementImport'

/** Выбор пользователя по строке: брать ли её и куда отнести. Пустая категория — «Без категории», transfer:id — перевод. */
interface Choice {
  checked?: boolean
  target?: string
}

const TRANSFER = 'transfer:'

export function ImportPage({ accounts, categories, transactions }: Data) {
  const [statement, setStatement] = useState<Statement | null>(null)
  const [fileName, setFileName] = useState('')
  const [accountId, setAccountId] = useState(() => defaultAccount(accounts)?.id ?? '')
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const account = accounts.find((a) => a.id === accountId)
  const items = useMemo(
    () => (statement && account ? prepareImport(statement.rows, account.id, transactions, categories) : []),
    [statement, account, transactions, categories],
  )

  const checkedOf = (item: ImportItem) => choices.get(item.key)?.checked ?? item.duplicateOf === null
  const targetOf = (item: ImportItem) => choices.get(item.key)?.target ?? item.categoryId ?? ''
  const selected = items.filter(checkedOf)
  const duplicates = items.filter((i) => i.duplicateOf !== null).length

  // Перевести можно только на счёт в той же валюте: сумму зачисления в другой валюте выписка не знает.
  const transferTargets = account ? pickingOrder(accounts.filter((a) => a.id !== account.id && a.currency === account.currency)) : []
  const targetOptions = (item: ImportItem): SelectOption[] => [
    ...categoryOptions(categories.filter((c) => c.kind === item.type)),
    ...transferTargets.map((a) => ({
      value: TRANSFER + a.id,
      label: accountLabel(a),
      group: item.type === 'expense' ? 'Перевод на свой счёт' : 'Перевод со своего счёта',
      icon: (
        <Avatar>
          <TransferIcon />
        </Avatar>
      ),
    })),
  ]

  async function openFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const parsed = await readStatementFile(file)
      if (parsed.rows.length === 0) throw new Error('В файле не нашлось ни одной операции')
      setStatement(parsed)
      setFileName(file.name)
      setChoices(new Map())
    } catch (err) {
      setStatement(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function choose(item: ImportItem, choice: Choice) {
    setChoices((prev) => {
      const next = new Map(prev)
      next.set(item.key, { ...prev.get(item.key), ...choice })
      // Категорию магазина сразу применяем к его остальным строкам, которые ещё не трогали.
      if (choice.target !== undefined) {
        const key = merchantKey(item.row.description)
        for (const other of items) {
          if (other.key === item.key || other.type !== item.type || !key || merchantKey(other.row.description) !== key) continue
          if (prev.get(other.key)?.target === undefined) next.set(other.key, { ...prev.get(other.key), target: choice.target })
        }
      }
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setChoices((prev) => new Map(items.map((i) => [i.key, { ...prev.get(i.key), checked: checked && i.duplicateOf === null }])))
  }

  async function save() {
    if (!account || selected.length === 0) return
    const records = selected.map((item) => {
      const target = targetOf(item)
      if (target.startsWith(TRANSFER)) {
        const other = target.slice(TRANSFER.length)
        const outgoing = item.type === 'expense'
        return newRecord<Transaction>({
          type: 'transfer',
          accountId: outgoing ? account.id : other,
          toAccountId: outgoing ? other : account.id,
          amount: item.amount,
          toAmount: null,
          categoryId: null,
          date: item.row.date,
          note: item.row.description,
        })
      }
      return newRecord<Transaction>({
        type: item.type,
        accountId: account.id,
        amount: item.amount,
        toAccountId: null,
        toAmount: null,
        categoryId: categories.some((c) => c.id === target && c.kind === item.type) ? target : null,
        date: item.row.date,
        note: item.row.description,
      })
    })
    await db.transactions.bulkAdd(records)
    setMessage(`Добавлено операций: ${records.length}. Категории магазинов запомнены для следующих выписок.`)
    setStatement(null)
    setChoices(new Map())
  }

  if (accounts.length === 0) {
    return <p className="empty">Сначала добавьте счёт на вкладке «Счета».</p>
  }

  const dates = statement ? statement.rows.map((r) => r.date).sort() : []
  const foreign = account ? items.filter((i) => i.row.currency && i.row.currency !== account.currency).length : 0

  return (
    <div className="import">
      <section className="card">
        <h3>Импорт выписки</h3>
        <p className="muted">
          Выгрузите выписку в приложении банка и откройте её здесь. Подходят CSV, Excel (.xlsx) и PDF. Операции, которые уже
          записаны, приложение найдёт само и не задвоит.
        </p>
        <details className="hint">
          <summary>Где взять выписку</summary>
          <p>
            <b>Т-Банк:</b> на сайте или в приложении откройте карту → «Выписка» или «Операции» → «Выгрузить». Лучше всего
            CSV.
          </p>
          <p>
            <b>Сбербанк:</b> карта → «Выписки и справки» → «Выписка по счёту» → PDF.
          </p>
          <p>
            <b>Альфа-Банк:</b> счёт → «Выписка» → выберите период и формат: Excel, а если его нет — PDF.
          </p>
          <p>Нужна сама выписка из приложения, а не фото или скан: из скана текст не прочитать.</p>
        </details>
        <label>
          Счёт, по которому выписка
          <Select title="Счёт" value={accountId} onChange={setAccountId} options={accountOptions(accounts)} />
        </label>
        <div className="actions">
          <label className={busy ? 'button primary disabled' : 'button primary'}>
            <UploadIcon />
            {busy ? 'Читаем файл…' : statement ? 'Другой файл' : 'Выбрать файл'}
            <input
              type="file"
              hidden
              disabled={busy}
              accept=".csv,.txt,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={openFile}
            />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        {message && <p className="result">{message}</p>}
      </section>

      {statement && account && (
        <>
          <div className="import-summary">
            <div>
              <strong>
                {statement.bank} · {fileName}
              </strong>
              <span className="muted">
                {formatDate(dates[0])} – {formatDate(dates[dates.length - 1])} · операций: {items.length}, новых: {items.length - duplicates}
                {duplicates > 0 && `, уже записаны: ${duplicates}`}
              </span>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={items.some((i) => i.duplicateOf === null) && items.every((i) => checkedOf(i) === (i.duplicateOf === null))}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              Все новые
            </label>
          </div>

          {foreign > 0 && (
            <p className="hint">
              У {foreign} операций валюта не совпадает с валютой счёта ({account.currency}). Проверьте, что выбран нужный счёт.
            </p>
          )}

          <ul className="list import-list">
            {items.map((item) => {
              const checked = checkedOf(item)
              const target = targetOf(item)
              const isTransfer = target.startsWith(TRANSFER)
              return (
                <li key={item.key} className={checked ? '' : 'dim'}>
                  <div className="import-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`Добавить: ${item.row.description || 'операция'} ${formatDate(item.row.date)}`}
                      onChange={(e) => choose(item, { checked: e.target.checked })}
                    />
                    <span className="row-main">
                      <span>{item.row.description || 'Без описания'}</span>
                      <span className="muted">
                        {[formatDate(item.row.date), item.row.bankCategory, item.duplicateOf && 'уже записана'].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={`amount ${isTransfer ? 'transfer' : item.type}`}>
                      {isTransfer ? '' : item.type === 'income' ? '+' : '−'}
                      {formatAmount(item.amount, account.currency)}
                    </span>
                  </div>
                  {checked && (
                    <div className="import-target">
                      <Select title="Категория" value={target} onChange={(v) => choose(item, { target: v })} options={targetOptions(item)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="import-save">
            <button type="button" className="primary" disabled={selected.length === 0} onClick={save}>
              {selected.length === 0 ? 'Ничего не выбрано' : `Добавить операций: ${selected.length}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
