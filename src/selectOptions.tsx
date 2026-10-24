import { ACCOUNT_KINDS, accountLabel, favoriteAccount, pickingOrder } from './accountKinds'
import { Avatar } from './components/Avatar'
import type { SelectOption } from './components/Select'
import type { Account, Category } from './db'
import { CURRENCIES } from './money'

/** Счета для выпадающего списка: основной первым, дальше по типам, внутри типа по алфавиту. */
export function accountOptions(accounts: Account[]): SelectOption[] {
  const grouped = new Set(accounts.map((a) => a.kind)).size > 1
  const favorite = favoriteAccount(accounts)
  const ordered = pickingOrder(accounts)
  const option = (a: Account, group: string | undefined): SelectOption => {
    const kind = ACCOUNT_KINDS.find((k) => k.kind === a.kind)!
    return {
      value: a.id,
      label: a.name,
      // В списке тип виден по заголовку группы, а в закрытом поле — только по пометке.
      selectedLabel: accountLabel(a),
      hint: a === favorite ? `${a.currency} · основной` : a.currency,
      group,
      icon: (
        <Avatar id={a.id} label={a.name}>
          {kind.icon}
        </Avatar>
      ),
    }
  }
  return [
    ...(favorite ? [option(favorite, grouped ? 'Основной' : undefined)] : []),
    ...ACCOUNT_KINDS.flatMap(({ kind, group }) =>
      ordered.filter((a) => a !== favorite && a.kind === kind).map((a) => option(a, grouped ? group : undefined)),
    ),
  ]
}

/** Категории для выпадающего списка; первым идёт вариант «Без категории» с пустым значением. */
export function categoryOptions(categories: Category[]): SelectOption[] {
  return [
    { value: '', label: 'Без категории', icon: <Avatar label="—" /> },
    ...[...categories]
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((c) => ({ value: c.id, label: c.name, icon: <Avatar id={c.id} label={c.name} /> })),
  ]
}

export const CURRENCY_OPTIONS: SelectOption[] = CURRENCIES.map((c) => ({ value: c, label: c }))
