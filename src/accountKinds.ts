import type { Account, AccountKind } from './db'

export const ACCOUNT_KINDS: {
  kind: AccountKind
  group: string
  label: string
  /** Короткая пометка типа перед названием счёта. */
  short: string
  /** Если название уже содержит это слово, пометка не нужна: «Кредитка Кредитка» не пишем. */
  stem: RegExp
  icon: string | null
}[] = [
  { kind: 'regular', group: 'Обычные счета', label: 'Обычный счёт', short: 'Счёт', stem: /сч[её]т/i, icon: null },
  { kind: 'savings', group: 'Сбережения', label: 'Сберегательный счёт', short: 'Накоп.', stem: /накоп|сбереж|вклад/i, icon: '🏦' },
  { kind: 'credit_card', group: 'Кредитные карты', label: 'Кредитная карта', short: 'Кредитка', stem: /кред/i, icon: '💳' },
  { kind: 'loan', group: 'Кредиты', label: 'Кредит', short: 'Кредит', stem: /кред|ипотек|за[её]м|займ/i, icon: '📄' },
]

export const ACCOUNT_KIND_ORDER: AccountKind[] = ACCOUNT_KINDS.map((k) => k.kind)

/** У кредитов и кредитных карт остаток вводится как долг и хранится отрицательным. */
export function isDebtKind(kind: AccountKind): boolean {
  return kind === 'credit_card' || kind === 'loan'
}

/** Название счёта с пометкой типа: «Кредитка Сбер-банк», «Счёт Карта». */
export function accountLabel(account: Pick<Account, 'kind' | 'name'>): string {
  const info = ACCOUNT_KINDS.find((k) => k.kind === account.kind)
  if (!info || info.stem.test(account.name)) return account.name
  return `${info.short} ${account.name}`
}

const byName = (a: Account, b: Account) => a.name.localeCompare(b.name, 'ru')

/**
 * Основной счёт. Если его отметили на двух устройствах до синхронизации, звёздочка окажется у обоих —
 * тогда главный тот, что отметили позже.
 */
export function favoriteAccount(accounts: Account[]): Account | undefined {
  return accounts.filter((a) => a.favorite).sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/** Счета в порядке выбора: основной первым, остальные по алфавиту. */
export function pickingOrder(accounts: Account[]): Account[] {
  const favorite = favoriteAccount(accounts)
  const rest = accounts.filter((a) => a !== favorite).sort(byName)
  return favorite ? [favorite, ...rest] : rest
}

/**
 * Счёт для новой операции: основной, а без него — первый по алфавиту из тех, которыми платят
 * (обычные счета и кредитные карты), чтобы по умолчанию не подставлялся кредит или вклад.
 */
export function defaultAccount(accounts: Account[]): Account | undefined {
  const favorite = favoriteAccount(accounts)
  if (favorite) return favorite
  const spending = accounts.filter((a) => a.kind === 'regular' || a.kind === 'credit_card')
  return [...(spending.length > 0 ? spending : accounts)].sort(byName)[0]
}
