// Настольное приложение: то же веб-приложение из папки dist в собственном окне.
// Данные хранятся в профиле программы, отдельно от браузера, — переносятся файлом копии или синхронизацией.
const { app, BrowserWindow, net, protocol, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIST = path.join(__dirname, '..', 'dist')
// Постоянный адрес app://finanse — к нему привязана база данных, поэтому менять его нельзя.
const ORIGIN = 'app://finanse'

// Папка с данными не должна зависеть от отображаемого названия программы.
app.setPath('userData', path.join(app.getPath('appData'), 'finanse'))

// Своя схема должна вести себя как обычный защищённый сайт: иначе не работают база, уведомления и офлайн-кеш.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true, stream: true } },
])

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#0e1312',
    icon: path.join(DIST, 'icon-512.png'),
    webPreferences: {
      // Сервер синхронизации в домашней сети работает по обычному HTTP — разрешаем обращаться к нему.
      allowRunningInsecureContent: true,
    },
  })
  // Ссылки наружу открываются в обычном браузере, а не внутри программы.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.loadURL(`${ORIGIN}/`)
}

// Второй запуск не открывает вторую копию с той же базой, а показывает уже открытое окно.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url)
      let file = path.join(DIST, decodeURIComponent(pathname))
      // За пределы папки приложения не выходим; всё, что не файл, — это само одностраничное приложение.
      if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(DIST, 'index.html')
      }
      return net.fetch(pathToFileURL(file).toString())
    })
    createWindow()
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  })

  app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
}
