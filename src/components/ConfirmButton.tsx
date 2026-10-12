import { useEffect, useState } from 'react'

/**
 * Кнопка для необратимых действий: первое нажатие только «взводит» её и меняет подпись,
 * действие выполняется вторым. Если передумать, через несколько секунд она вернётся в исходный вид.
 */
export function ConfirmButton({
  label,
  armedLabel = 'Точно удалить?',
  className = 'danger',
  onConfirm,
}: {
  label: string
  armedLabel?: string
  className?: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <button
      type="button"
      className={armed ? `${className} armed` : className}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? armedLabel : label}
    </button>
  )
}
