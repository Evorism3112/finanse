// Голосовой ввод: на телефоне — системное распознавание речи Android, в браузере — Web Speech API, где он есть.
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { isNative } from './native'

interface WebRecognition {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
}

type WebRecognitionClass = new () => WebRecognition

function webRecognition(): WebRecognitionClass | undefined {
  // В настольной программе (Electron) объект есть, но без ключа Google он не работает.
  if (/Electron/.test(navigator.userAgent)) return undefined
  const w = window as unknown as { SpeechRecognition?: WebRecognitionClass; webkitSpeechRecognition?: WebRecognitionClass }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** Можно ли говорить вместо набора на этом устройстве. */
export async function voiceAvailable(): Promise<boolean> {
  if (isNative) {
    try {
      return (await SpeechRecognition.available()).available
    } catch {
      return false
    }
  }
  return webRecognition() !== undefined
}

/** Ошибка, которую стоит показать: нет разрешения на микрофон или распознавание не удалось. */
export class VoiceError extends Error {}

/**
 * Слушает одну фразу и возвращает её текстом; null — ничего не сказали или отменили.
 * На Android показывает стандартное окно распознавания Google.
 */
export async function listen(prompt: string): Promise<string | null> {
  if (isNative) {
    let { speechRecognition } = await SpeechRecognition.checkPermissions()
    if (speechRecognition !== 'granted') ({ speechRecognition } = await SpeechRecognition.requestPermissions())
    if (speechRecognition !== 'granted') throw new VoiceError('Нет доступа к микрофону. Разрешите его приложению в настройках телефона.')
    try {
      const { matches } = await SpeechRecognition.start({ language: 'ru-RU', maxResults: 1, popup: true, partialResults: false, prompt })
      return matches?.[0]?.trim() || null
    } catch {
      // Окно закрыли или ничего не распознали — это не ошибка.
      return null
    }
  }

  const Recognition = webRecognition()
  if (!Recognition) throw new VoiceError('Голосовой ввод в этом браузере недоступен.')
  return new Promise((resolve, reject) => {
    const r = new Recognition()
    let heard: string | null = null
    r.lang = 'ru-RU'
    r.interimResults = false
    r.maxAlternatives = 1
    r.onresult = (e) => {
      heard = e.results[0]?.[0]?.transcript.trim() || null
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') reject(new VoiceError('Нет доступа к микрофону.'))
    }
    r.onend = () => resolve(heard)
    r.start()
  })
}
