import type { ComponentType } from 'react'
import { BankIcon, CardIcon, PercentIcon, WalletIcon } from './components/Icons'
import type { Account, AccountKind } from './db'

export const ACCOUNT_KINDS: {
  kind: AccountKind
  group: string
  label: string
  /** Короткая пометка типа перед названием счёта. */
  short: string
  /** Если название уже содержит это слово, пометка не нужна: «Кредитка Кредитка» не пишем. */
  stem: RegExp
  Icon: ComponentType
  /** Цвет значка счетов этого типа. */
  color: string
}[] = [
  { kind: 'regular', group: 'Обычные счета', label: 'Обычный счёт', short: 'Счёт', stem: /сч[её]т/i, Icon: WalletIcon, color: '#7AA7FF' },
  { kind: 'savings', group: 'Сбережения', label: 'Сберегательный счёт', short: 'Накоп.', stem: /накоп|сбереж|вклад/i, Icon: BankIcon, color: '#5ED3E6' },
  { kind: 'credit_card', group: 'Кредитные карты', label: 'Кредитная карта', short: 'Кредитка', stem: /кред/i, Icon: CardIcon, color: '#FFB35C' },
  { kind: 'loan', group: 'Кредиты', label: 'Кредит', short: 'Кредит', stem: /кред|ипотек|за[её]м|займ/i, Icon: PercentIcon, color: '#B69CFF' },
]

/** Название счёта с пометкой типа: «Кредитка Сбер-банк», «Счёт Карта». */
export function accountLabel(account: Pick<Account, 'kind' | 'name'>): string {
  const info = ACCOUNT_KINDS.find((k) => k.kind === account.kind)
  if (!info || info.stem.test(account.name)) return account.name
  return `${info.short} ${account.name}`
}
