import { useState, type FormEvent } from 'react'
import { Avatar } from '../components/Avatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { Modal } from '../components/Modal'
import { db, deleted, newRecord, touched, type Category, type CategoryKind, type Data } from '../db'
import { amountToInput, formatAmount, parseAmount } from '../money'
import { mainCurrency } from '../stats'

const KINDS: [CategoryKind, string][] = [
  ['expense', 'Расходы'],
  ['income', 'Доходы'],
]

export function CategoriesPage({ accounts, categories }: Data) {
  const [editing, setEditing] = useState<Category | CategoryKind | null>(null)
  const currency = mainCurrency(accounts)

  return (
    <>
      <div className="columns">
        {KINDS.map(([kind, label]) => (
          <section key={kind}>
            <h3 className="group-title">{label}</h3>
            <ul className="list">
              {categories
                .filter((c) => c.kind === kind)
                .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
                .map((c) => (
                  <li key={c.id}>
                    <button type="button" className="row" onClick={() => setEditing(c)}>
                      <Avatar id={c.id} label={c.name} />
                      <span className="row-main">
                        <span>{c.name}</span>
                        {c.budget != null && <span className="muted">лимит {formatAmount(c.budget, currency)} в месяц</span>}
                      </span>
                    </button>
                  </li>
                ))}
              <li>
                <button type="button" className="row add" onClick={() => setEditing(kind)}>
                  + Добавить категорию
                </button>
              </li>
            </ul>
          </section>
        ))}
      </div>

      {editing && (
        <CategoryForm
          category={typeof editing === 'string' ? null : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function CategoryForm({
  category,
  kind,
  currency,
  onClose,
}: {
  category: Category | null
  kind: CategoryKind
  currency: string
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [budget, setBudget] = useState(category?.budget != null ? amountToInput(category.budget) : '')
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Введите название')

    let parsedBudget: number | null = null
    if (kind === 'expense' && budget.trim() !== '') {
      parsedBudget = parseAmount(budget)
      if (parsedBudget === null || parsedBudget <= 0) return setError('Лимит — это число больше нуля')
    }

    const fields = { name: trimmed, budget: parsedBudget }
    if (category) await db.categories.update(category.id, { ...fields, ...touched() })
    else await db.categories.add(newRecord<Category>({ ...fields, kind }))
    onClose()
  }

  async function remove() {
    if (!category) return
    await db.categories.update(category.id, deleted())
    onClose()
  }

  return (
    <Modal title={category ? 'Категория' : kind === 'expense' ? 'Новая категория расходов' : 'Новая категория доходов'} onClose={onClose}>
      <form onSubmit={save}>
        <label>
          Название
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {kind === 'expense' && (
          <label>
            Лимит расходов в месяц, {currency} (необязательно)
            <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Без лимита" />
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {category && (
            <ConfirmButton label="Удалить" armedLabel="Удалить? Операции останутся без категории" onConfirm={remove} />
          )}
          <button type="submit" className="primary">
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  )
}
