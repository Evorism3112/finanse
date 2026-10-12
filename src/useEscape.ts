import { useEffect, useRef } from 'react'

// Открытые окна в порядке появления. Escape закрывает только верхнее:
// список или календарь поверх формы, а не форму под ними.
const stack: (() => void)[] = []

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || stack.length === 0) return
  e.preventDefault()
  stack[stack.length - 1]()
}

/** Закрывает окно по клавише Escape, пока компонент на экране. */
export function useEscape(onClose: () => void) {
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    const close = () => latest.current()
    stack.push(close)
    if (stack.length === 1) document.addEventListener('keydown', onKeyDown)
    return () => {
      stack.splice(stack.indexOf(close), 1)
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
