import { LocalNotifications } from '@capacitor/local-notifications'
import { isNative } from './native'
import type { UpcomingReminder } from './reminders'

export interface Reminder {
  /** id подписки или счёта. */
  id: string
  title: string
  body: string
}

// Здесь запоминаем, о чём в какой день уже напомнили: не чаще раза в день на каждую запись.
const SENT_KEY = 'finanse:notified'

export type NotifyState = NotificationPermission | 'unsupported'

// На телефоне разрешение узнаётся асинхронно, поэтому держим последнее известное значение.
let nativeState: NotifyState = 'default'

const fromNative = (display: string): NotifyState => (display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default')

/** Вызывается один раз при запуске, до первого показа интерфейса. */
export async function initNotifications(): Promise<void> {
  if (!isNative) return
  try {
    nativeState = fromNative((await LocalNotifications.checkPermissions()).display)
  } catch {
    nativeState = 'unsupported'
  }
}

export function notifyState(): NotifyState {
  if (isNative) return nativeState
  return 'Notification' in window ? Notification.permission : 'unsupported'
}

export async function requestNotifications(): Promise<NotifyState> {
  if (isNative) {
    nativeState = fromNative((await LocalNotifications.requestPermissions()).display)
    return nativeState
  }
  if (!('Notification' in window)) return 'unsupported'
  return Notification.requestPermission()
}

// Номер уведомления на телефоне — целое число. Старший бит отделяет запланированные на будущее
// от показанных сразу, чтобы пересчёт расписания не снимал сегодняшние.
const FUTURE = 0x40000000

function numericId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0x3fffffff
  return hash
}

let running = false

/** Показывает уведомления о том, что требует внимания уже сегодня. */
export async function notifyDue(reminders: Reminder[], today: string): Promise<void> {
  if (running || notifyState() !== 'granted') return
  running = true
  try {
    let sent: Record<string, string> = {}
    try {
      sent = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}')
    } catch {
      // Повреждённая запись — начинаем с чистого листа.
    }
    const pending = reminders.filter((r) => sent[r.id] !== today)
    if (pending.length === 0) return

    if (isNative) {
      await LocalNotifications.schedule({
        notifications: pending.map((r) => ({ id: numericId(r.id), title: r.title, body: r.body, schedule: { at: new Date(Date.now() + 1000) } })),
      })
      for (const r of pending) sent[r.id] = today
    } else {
      // На Android в браузере уведомление можно показать только через сервис-воркер.
      const registration = await navigator.serviceWorker?.getRegistration()
      for (const { id, title, body } of pending) {
        const options = { body, tag: id, icon: 'icon-192.png' }
        try {
          if (registration) await registration.showNotification(title, options)
          else new Notification(title, options)
          sent[id] = today
        } catch {
          // Не получилось показать — попробуем при следующей проверке.
        }
      }
    }

    const alive = new Set(reminders.map((r) => r.id))
    for (const id of Object.keys(sent)) if (!alive.has(id)) delete sent[id]
    localStorage.setItem(SENT_KEY, JSON.stringify(sent))
  } finally {
    running = false
  }
}

/** Сколько напоминаний ставим в расписание телефона: у системы есть предел на число будильников одного приложения. */
const MAX_SCHEDULED = 60

let scheduling: Promise<void> = Promise.resolve()

/**
 * Только в приложении для телефона: ставит напоминания на будущие даты в расписание системы,
 * чтобы они пришли и при закрытом приложении. Каждый вызов заменяет прежнее расписание целиком.
 */
export function scheduleUpcoming(reminders: UpcomingReminder[]): Promise<void> {
  if (!isNative) return Promise.resolve()
  // Вызовы идут строго по очереди: иначе два пересчёта подряд перемешали бы отмену и постановку.
  scheduling = scheduling
    .then(async () => {
      if (nativeState !== 'granted') return
      const { notifications } = await LocalNotifications.getPending()
      const old = notifications.filter((n) => n.id >= FUTURE).map((n) => ({ id: n.id }))
      if (old.length > 0) await LocalNotifications.cancel({ notifications: old })
      const next = reminders.slice(0, MAX_SCHEDULED).map((r) => {
        const [year, month, day] = r.date.split('-').map(Number)
        // Девять утра по времени телефона.
        return { id: numericId(r.id) | FUTURE, title: r.title, body: r.body, schedule: { at: new Date(year, month - 1, day, 9, 0), allowWhileIdle: true } }
      })
      if (next.length > 0) await LocalNotifications.schedule({ notifications: next })
    })
    .catch(() => {})
  return scheduling
}
