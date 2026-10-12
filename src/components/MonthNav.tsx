import { monthLabel, shiftMonth } from '../dates'
import { ChevronLeftIcon, ChevronRightIcon } from './Icons'

export function MonthNav({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return (
    <div className="month-nav">
      <button type="button" className="icon-btn" aria-label="Предыдущий месяц" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeftIcon />
      </button>
      <span>{monthLabel(month)}</span>
      <button type="button" className="icon-btn" aria-label="Следующий месяц" onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRightIcon />
      </button>
    </div>
  )
}
