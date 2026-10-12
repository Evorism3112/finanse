import { ACCOUNT_KINDS, accountLabel } from './accountKinds'
import { Avatar } from './components/Avatar'
import type { SelectOption } from './components/Select'
import type { Account, Category } from './db'
import { CURRENCIES } from './money'

/** Счета для выпадающего списка, с разбивкой по типам, если типов больше одного. */
export function accountOptions(accounts: Account[]): SelectOption[] {
  const grouped = new Set(accounts.map((a) => a.kind)).size > 1
  return ACCOUNT_KINDS.flatMap(({ kind, group, icon }) =>
    accounts
      .filter((a) => a.kind === kind)
      .map((a) => ({
        value: a.id,
        label: a.name,
        // В списке тип виден по заголовку группы, а в закрытом поле — только по пометке.
        selectedLabel: accountLabel(a),
        hint: a.currency,
        group: grouped ? group : undefined,
        icon: (
          <Avatar id={a.id} label={a.name}>
            {icon}
          </Avatar>
        ),
      })),
  )
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
