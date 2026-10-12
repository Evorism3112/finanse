import type { CSSProperties } from 'react'

/**
 * Постоянный оттенок для записи: один и тот же id всегда даёт один цвет.
 * Красные оттенки пропускаем, чтобы цвет категории не читался как «расход».
 */
export function hueStyle(id: string): CSSProperties {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 280
  return { '--h': 40 + hash } as CSSProperties
}
