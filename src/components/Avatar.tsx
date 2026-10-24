import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { colorOf } from '../colors'
import {
  BoxIcon,
  BriefcaseIcon,
  BusIcon,
  CartIcon,
  CoffeeIcon,
  CoinsIcon,
  FilmIcon,
  HeartIcon,
  HouseIcon,
  PercentIcon,
  RepeatIcon,
} from './Icons'

/** Иконки стандартных категорий. Свои категории получают первую букву. */
const DEFAULT_ICONS: Record<string, ComponentType> = {
  'default-food': CartIcon,
  'default-transport': BusIcon,
  'default-housing': HouseIcon,
  'default-cafe': CoffeeIcon,
  'default-health': HeartIcon,
  'default-fun': FilmIcon,
  'default-subscriptions': RepeatIcon,
  'default-interest': PercentIcon,
  'default-other-expense': BoxIcon,
  'default-salary': BriefcaseIcon,
  'default-other-income': CoinsIcon,
}

/** Цветной значок записи. Без id — нейтральный, для переводов и «без категории»; color заменяет цвет по id. */
export function Avatar({ id, label, color, children }: { id?: string | null; label?: string; color?: string; children?: ReactNode }) {
  const Icon = id ? DEFAULT_ICONS[id] : undefined
  const content = children ?? (Icon ? <Icon /> : ([...(label ?? '')][0]?.toUpperCase() ?? '?'))
  return (
    <span className={id ? 'avatar' : 'avatar neutral'} style={id ? ({ '--c': color ?? colorOf(id) } as CSSProperties) : undefined} aria-hidden="true">
      {content}
    </span>
  )
}
