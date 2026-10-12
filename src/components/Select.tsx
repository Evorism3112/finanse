import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from '../useEscape'
import { CheckIcon, ChevronDownIcon, CloseIcon } from './Icons'

export interface SelectOption {
  value: string
  label: string
  /** Текст в самом поле, когда вариант выбран; по умолчанию — label. */
  selectedLabel?: string
  /** Пояснение мелким шрифтом под названием. */
  hint?: string
  /** Заголовок группы; подряд идущие варианты с одной группой объединяются под ним. */
  group?: string
  icon?: ReactNode
}

/**
 * Выпадающий список в стиле приложения: поле-кнопка и панель с вариантами вместо системного списка браузера.
 */
export function Select({
  title,
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Выберите',
}: {
  title: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <>
      <button
        type="button"
        className="select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className={selected ? 'select-value' : 'select-value placeholder'}>{selected ? (selected.selectedLabel ?? selected.label) : placeholder}</span>
        <ChevronDownIcon />
      </button>
      {/* Панель рисуется в body: внутри <label> любое нажатие по ней снова открывало бы список. */}
      {open &&
        createPortal(
          <Sheet
            title={title}
            value={value}
            options={options}
            onClose={() => setOpen(false)}
            onPick={(picked) => {
              setOpen(false)
              onChange(picked)
            }}
          />,
          document.body,
        )}
    </>
  )
}

function Sheet({
  title,
  value,
  options,
  onClose,
  onPick,
}: {
  title: string
  value: string
  options: SelectOption[]
  onClose: () => void
  onPick: (value: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEscape(onClose)

  useEffect(() => {
    const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    // Фокус на выбранном варианте: он же прокручивает к нему длинный список.
    ;(items().find((b) => b.getAttribute('aria-selected') === 'true') ?? items()[0])?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const all = items()
      const index = all.indexOf(document.activeElement as HTMLButtonElement)
      all[(index + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="overlay sheet-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть список" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="options" role="listbox" aria-label={title} ref={list}>
          {options.map((o, i) => (
            <div key={o.value} className="option-wrap">
              {o.group && o.group !== options[i - 1]?.group && <div className="option-group">{o.group}</div>}
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={o.value === value ? 'option selected' : 'option'}
                onClick={() => onPick(o.value)}
              >
                {o.icon}
                <span className="row-main">
                  <span className="option-label">{o.label}</span>
                  {o.hint && <span className="muted">{o.hint}</span>}
                </span>
                {o.value === value && <CheckIcon />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
