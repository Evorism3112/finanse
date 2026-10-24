import { useEffect, useState } from 'react'
import { listen, voiceAvailable, VoiceError } from '../voice'
import { MicIcon } from './Icons'

/** Кнопка с микрофоном: слушает одну фразу и отдаёт её текстом. Где голосового ввода нет, кнопки тоже нет. */
export function VoiceButton({
  prompt,
  className = 'icon-btn boxed',
  onText,
  onError,
}: {
  prompt: string
  className?: string
  onText: (text: string) => void
  onError: (message: string) => void
}) {
  const [available, setAvailable] = useState(false)
  const [listening, setListening] = useState(false)

  useEffect(() => {
    let alive = true
    void voiceAvailable().then((ok) => alive && setAvailable(ok))
    return () => {
      alive = false
    }
  }, [])

  if (!available) return null

  async function start() {
    setListening(true)
    try {
      const text = await listen(prompt)
      if (text) onText(text)
    } catch (error) {
      onError(error instanceof VoiceError ? error.message : 'Не удалось распознать речь.')
    } finally {
      setListening(false)
    }
  }

  return (
    <button
      type="button"
      className={listening ? `${className} voice listening` : `${className} voice`}
      aria-label={listening ? 'Слушаю…' : 'Сказать голосом'}
      aria-pressed={listening}
      disabled={listening}
      onClick={() => void start()}
    >
      <MicIcon />
    </button>
  )
}
