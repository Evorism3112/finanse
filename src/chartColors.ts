/** Сколько цветов в палитре диаграмм (--series-1 … --series-8 в index.css). */
export const SERIES_COUNT = 8

/**
 * Раздаёт цвета палитры секторам диаграммы. Цвет привязан к записи, а не к её месту в рейтинге:
 * у каждой записи есть «своё» место по порядку в order, и оно меняется, только если занято другим сектором.
 * Возвращает секторы в порядке order с номером цвета от 0.
 */
export function assignSlots(order: string[], shown: string[]): [key: string, slot: number][] {
  const position = new Map(order.map((key, i) => [key, i]))
  const sorted = [...shown].sort((a, b) => (position.get(a) ?? order.length) - (position.get(b) ?? order.length))
  const taken = new Set<number>()
  return sorted.slice(0, SERIES_COUNT).map((key, i) => {
    let slot = (position.get(key) ?? order.length + i) % SERIES_COUNT
    while (taken.has(slot)) slot = (slot + 1) % SERIES_COUNT
    taken.add(slot)
    return [key, slot]
  })
}
