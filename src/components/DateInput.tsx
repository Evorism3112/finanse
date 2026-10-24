import { useState } from 'react'
import { createPortal } from 'react-dom'
import { currentMonth, formatDate, monthLabel, parseDate, shiftMonth, today } from '../dates'
import { useEscape } from '../useEscape'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './Icons'

/**
 * Поле даты в виде ДД.ММ.ГГ с календарём в стиле приложения.
 * Наружу отдаёт дату как ГГГГ-ММ-ДД или пустую строку, пока ввод не стал датой.
 */
export function DateInput({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [text, setText] = useState(() => formatDate(value))
  const [open, setOpen] = useState(false)

  function type(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 6)
    let next = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join('.')
    // Точку дописываем только при наборе вперёд, иначе её нельзя было бы стереть.
    if (raw.length > text.length && (digits.length === 2 || digits.length === 4)) next += '.'
    setText(next)
    onChange(parseDate(next) ?? '')
  }

  return (
    <span className="date-input">
      <input
        className={text !== '' && value === '' ? 'invalid' : ''}
        inputMode="numeric"
        placeholder="ДД.ММ.ГГ"
        value={text}
        onChange={(e) => type(e.target.value)}
      />
      <button type="button" className="icon-btn" aria-label="Открыть календарь" onClick={() => setOpen(true)}>
        <CalendarIcon />
      </button>
      {/* Календарь рисуется в body: внутри <label> нажатия по нему уходили бы в поле ввода. */}
      {open &&
        createPortal(
          <Calendar
            value={value}
            onClose={() => setOpen(false)}
            onPick={(date) => {
              setOpen(false)
              setText(formatDate(date))
              onChange(date)
            }}
          />,
          document.body,
        )}
    </span>
  )
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function Calendar({ value, onClose, onPick }: { value: string; onClose: () => void; onPick: (date: string) => void }) {
  const [month, setMonth] = useState(() => (value ? value.slice(0, 7) : currentMonth()))
  const now = today()

  useEscape(onClose)

  const [year, monthNumber] = month.split('-').map(Number)
  // Неделя начинается с понедельника: сдвигаем воскресенье (0) в конец.
  const blanks = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
  const days = new Date(year, monthNumber, 0).getDate()

  return (
    <div className="overlay sheet-overlay" onClick={onClose}>
      <div className="modal sheet calendar" role="dialog" aria-label="Выбор даты" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Выбор даты</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть календарь" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="calendar-nav">
          <button type="button" className="icon-btn" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeftIcon />
          </button>
          <span>{monthLabel(month)}</span>
          <button type="button" className="icon-btn" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRightIcon />
          </button>
        </div>

        <div className="calendar-grid">
          {WEEKDAYS.map((d, i) => (
            <span key={d} className={i >= 5 ? 'weekday weekend' : 'weekday'}>
              {d}
            </span>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, '0')}`
            const classes = ['day', date === value && 'selected', date === now && 'today'].filter(Boolean).join(' ')
            return (
              <button key={date} type="button" className={classes} aria-pressed={date === value} onClick={() => onPick(date)}>
                {i + 1}
              </button>
            )
          })}
        </div>

        <div className="actions">
          <button type="button" onClick={() => onPick(now)}>
            Сегодня
          </button>
        </div>
      </div>
    </div>
  )
}
