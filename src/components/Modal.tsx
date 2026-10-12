import type { ReactNode } from 'react'
import { useEscape } from '../useEscape'
import { CloseIcon } from './Icons'

/** Окно с формой. wide — на широком экране окно шире, а поля формы идут в две колонки, чтобы не прокручивать. */
export function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  useEscape(onClose)

  return (
    <div className="overlay" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
