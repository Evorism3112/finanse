import type { ReactNode } from 'react'
import { hueStyle } from '../hue'

const DEFAULT_ICONS: Record<string, string> = {
  'default-food': '🛒',
  'default-transport': '🚌',
  'default-housing': '🏠',
  'default-cafe': '🍽️',
  'default-health': '💊',
  'default-fun': '🎬',
  'default-subscriptions': '🔁',
  'default-interest': '🧾',
  'default-other-expense': '📦',
  'default-salary': '💼',
  'default-other-income': '💰',
}

/** Цветной кружок записи. Без id — нейтральный, для переводов и «без категории». */
export function Avatar({ id, label, children }: { id?: string | null; label?: string; children?: ReactNode }) {
  const content = children ?? (id && DEFAULT_ICONS[id]) ?? [...(label ?? '')][0]?.toUpperCase() ?? '?'
  return (
    <span className={id ? 'avatar' : 'avatar neutral'} style={id ? hueStyle(id) : undefined} aria-hidden="true">
      {content}
    </span>
  )
}
