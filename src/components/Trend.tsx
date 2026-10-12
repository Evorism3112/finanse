import { useState } from 'react'
import { monthLabel, monthShort } from '../dates'
import type { MonthPoint } from '../stats'

/**
 * Доходы и расходы по месяцам парными столбиками. Строка над графиком показывает точные суммы месяца,
 * на который навели, а без наведения — выбранного. Нажатие на месяц открывает его в отчёте.
 */
export function Trend({
  points,
  month,
  format,
  onPick,
}: {
  points: MonthPoint[]
  month: string
  format: (value: number) => string
  onPick: (month: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)

  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]))
  const shown = points.find((p) => p.month === (hover ?? month)) ?? points[points.length - 1]
  const height = (value: number) => (value > 0 ? `max(2px, ${(value / max) * 100}%)` : '0')

  return (
    <div className="trend">
      <div className="trend-readout">
        <strong>{monthLabel(shown.month)}</strong>
        <span>
          <span className="swatch income" />
          Доходы {format(shown.income)}
        </span>
        <span>
          <span className="swatch expense" />
          Расходы {format(shown.expense)}
        </span>
      </div>
      <div className="trend-bars">
        {points.map((p) => (
          <button
            key={p.month}
            type="button"
            className={p.month === month ? 'trend-col active' : 'trend-col'}
            aria-label={`${monthLabel(p.month)}: доходы ${format(p.income)}, расходы ${format(p.expense)}`}
            aria-pressed={p.month === month}
            onClick={() => onPick(p.month)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(p.month)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
          >
            <span className="trend-pair">
              <span className="trend-bar income" style={{ height: height(p.income) }} />
              <span className="trend-bar expense" style={{ height: height(p.expense) }} />
            </span>
            <span className="trend-label">{monthShort(p.month)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
