export interface Slice {
  key: string
  label: string
  value: number
  color: string
}

const R = 76
const WIDTH = 30
const CIRCUMFERENCE = 2 * Math.PI * R
/** Зазор между секторами в единицах viewBox — примерно 2px на экране. */
const GAP = 2.5

/**
 * Кольцевая диаграмма долей. В центре — общий итог или данные сектора, на который навели или нажали.
 * Названия и точные суммы всегда есть в списке под диаграммой, поэтому цвет не единственный носитель смысла.
 */
export function Donut({
  slices,
  total,
  title,
  format,
  active,
  onActive,
}: {
  slices: Slice[]
  total: number
  title: string
  format: (value: number) => string
  active: string | null
  onActive: (key: string | null) => void
}) {
  const current = slices.find((s) => s.key === active)
  // Начало каждого сектора — сумма длин предыдущих.
  const lengths = slices.map((s) => (s.value / total) * CIRCUMFERENCE)
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((sum, length) => sum + length, 0))

  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${format(s.value)}`).join(', ')}`}>
        {slices.map((s, i) => {
          const length = lengths[i]
          const offset = offsets[i]
          return (
            <circle
              key={s.key}
              className={active === null || active === s.key ? '' : 'dim'}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={active === s.key ? WIDTH + 6 : WIDTH}
              strokeDasharray={`${Math.max(length - GAP, 0.5)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
              onPointerEnter={(e) => e.pointerType === 'mouse' && onActive(s.key)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && onActive(null)}
              onClick={() => onActive(active === s.key ? null : s.key)}
            />
          )
        })}
      </svg>
      <div className="donut-center">
        <span className="muted">{current ? current.label : title}</span>
        <strong>{format(current ? current.value : total)}</strong>
        {current && <span className="muted">{Math.round((current.value / total) * 100)}%</span>}
      </div>
    </div>
  )
}
