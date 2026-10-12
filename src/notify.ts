export interface Reminder {
  /** id подписки или счёта. */
  id: string
  title: string
  body: string
}

// Здесь запоминаем, о чём в какой день уже напомнили: не чаще раза в день на каждую запись.
const SENT_KEY = 'finanse:notified'

export type NotifyState = NotificationPermission | 'unsupported'

export function notifyState(): NotifyState {
  return 'Notification' in window ? Notification.permission : 'unsupported'
}

export async function requestNotifications(): Promise<NotifyState> {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.requestPermission()
}

let running = false

/** Показывает системные уведомления по подпискам и взносам, о которых пора напомнить. */
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

    // На Android уведомление можно показать только через сервис-воркер.
    const registration = await navigator.serviceWorker?.getRegistration()
    for (const { id, title, body } of pending) {
      const options = { body, tag: id, icon: '/icon-192.png' }
      try {
        if (registration) await registration.showNotification(title, options)
        else new Notification(title, options)
        sent[id] = today
      } catch {
        // Не получилось показать — попробуем при следующей проверке.
      }
    }

    const alive = new Set(reminders.map((r) => r.id))
    for (const id of Object.keys(sent)) if (!alive.has(id)) delete sent[id]
    localStorage.setItem(SENT_KEY, JSON.stringify(sent))
  } finally {
    running = false
  }
}
