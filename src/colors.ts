/** Цвета стандартных категорий; у остальных записей цвет выводится из id. */
const DEFAULT_COLORS: Record<string, string> = {
  'default-food': '#7AA7FF',
  'default-transport': '#E8E26A',
  'default-housing': '#5ED3E6',
  'default-cafe': '#FFB35C',
  'default-health': '#FF7A9A',
  'default-fun': '#F59AE0',
  'default-subscriptions': '#A3A9FF',
  'default-interest': '#B69CFF',
  'default-other-expense': '#9BA1AD',
  'default-salary': '#C8F560',
  'default-other-income': '#6EE7A8',
}

/**
 * Постоянный цвет записи: один и тот же id всегда даёт один цвет.
 * Красные оттенки пропускаем, чтобы цвет категории не читался как «расход».
 */
export function colorOf(id: string): string {
  const color = DEFAULT_COLORS[id]
  if (color) return color
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 280
  return `hsl(${40 + hash} 75% 70%)`
}
