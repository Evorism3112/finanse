// Подключается к сгенерированному сервис-воркеру: по нажатию на уведомление открывает приложение.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0]
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})
