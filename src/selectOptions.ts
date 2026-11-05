import type { SelectOption } from './components/Select'
import { CURRENCIES } from './money'

export const CURRENCY_OPTIONS: SelectOption[] = CURRENCIES.map((c) => ({ value: c, label: c }))
