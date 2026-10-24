import { accountLabel } from '../accountKinds'
import type { Account, Category, Transaction } from '../db'
import { formatAmount } from '../money'
import { Avatar } from './Avatar'
import { TransferIcon } from './Icons'

/** Строка операции: значок категории, название, счёт с комментарием и сумма. */
export function TxRow({
  tx,
  accountById,
  categoryById,
  onOpen,
}: {
  tx: Transaction
  accountById: Map<string, Account>
  categoryById: Map<string, Category>
  onOpen: (tx: Transaction) => void
}) {
  const account = accountById.get(tx.accountId)
  const toAccount = tx.toAccountId ? accountById.get(tx.toAccountId) : undefined
  const category = tx.categoryId ? categoryById.get(tx.categoryId) : undefined
  const title = tx.type === 'transfer' ? 'Перевод' : (category?.name ?? 'Без категории')
  const nameOf = (a: Account | undefined) => (a ? accountLabel(a) : '?')
  const sub = tx.type === 'transfer' ? `${nameOf(account)} → ${nameOf(toAccount)}` : account && nameOf(account)
  const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''
  return (
    <li>
      <button type="button" className="row" onClick={() => onOpen(tx)}>
        {tx.type === 'transfer' ? (
          <Avatar>
            <TransferIcon />
          </Avatar>
        ) : (
          <Avatar id={category?.id} label={category?.name} />
        )}
        <span className="row-main">
          <span>{title}</span>
          <span className="muted">{[sub, tx.note].filter(Boolean).join(' · ')}</span>
        </span>
        {/* Расход — обычным цветом, иначе весь список был бы оранжевым. */}
        <span className={tx.type === 'expense' ? 'amount' : `amount ${tx.type}`}>
          {sign}
          {formatAmount(tx.amount, account?.currency ?? 'RUB')}
        </span>
      </button>
    </li>
  )
}
