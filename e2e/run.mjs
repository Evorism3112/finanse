// Запускает сквозные проверки: поднимает собранное приложение и headless Firefox, прогоняет сценарии, всё гасит.
// Использование: npm run test:e2e [-- папка-для-скриншотов].
// По умолчанию берётся Firefox. Браузер на Chromium задаётся переменной E2E_BROWSER, например:
//   E2E_BROWSER=helium-browser npm run test:e2e
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const APP_PORT = 4199
const BIDI_PORT = 9333
const SYNC_PORT = 8798
const appUrl = process.env.E2E_APP_URL ?? `http://localhost:${APP_PORT}/`
const shotsDir = process.argv[2] ? resolve(process.argv[2]) : null
const browserCommand = process.env.E2E_BROWSER ?? 'firefox'
const isFirefox = /firefox/i.test(browserCommand)

const children = []
const start = (command, args, options = {}) => {
  const child = spawn(command, args, { stdio: 'ignore', ...options })
  children.push(child)
  return child
}
const stopAll = () => {
  for (const child of children.splice(0)) child.kill()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(url, what) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url)
      return
    } catch {
      await sleep(200)
    }
  }
  throw new Error(`не дождались: ${what}`)
}

/** Запускает сценарий в чистом профиле браузера и возвращает его код завершения. */
async function runScenario(script, args = [], env = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'finanse-e2e-'))
  // Экспорт копии не должен ничего спрашивать и писать в «Загрузки» пользователя.
  writeFileSync(
    join(profile, 'user.js'),
    [
      'user_pref("browser.download.folderList", 2);',
      `user_pref("browser.download.dir", ${JSON.stringify(profile)});`,
      'user_pref("browser.download.useDownloadDir", true);',
      'user_pref("browser.helperApps.neverAsk.saveToDisk", "application/json");',
    ].join('\n'),
  )
  const browser = isFirefox
    ? start(browserCommand, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(BIDI_PORT)])
    : start(browserCommand, [
        '--headless=new',
        `--remote-debugging-port=${BIDI_PORT}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank',
      ])
  try {
    await waitFor(`http://127.0.0.1:${BIDI_PORT}/${isFirefox ? '' : 'json/version'}`, browserCommand)
    // Chromium после старта ещё открывает свои служебные вкладки — даём ему закончить.
    if (!isFirefox) await sleep(2000)
    const scenario = spawn(process.execPath, [join(here, script), ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_BIDI_PORT: String(BIDI_PORT),
        E2E_APP_URL: appUrl,
        E2E_PROTOCOL: isFirefox ? 'bidi' : 'cdp',
        E2E_DOWNLOAD_DIR: profile,
        ...env,
      },
    })
    return await new Promise((done) => scenario.on('exit', (code) => done(code ?? 1)))
  } finally {
    browser.kill()
    children.splice(children.indexOf(browser), 1)
    await sleep(500)
    rmSync(profile, { recursive: true, force: true })
  }
}

process.on('SIGINT', () => {
  stopAll()
  process.exit(130)
})

let failed = false
try {
  // По умолчанию проверяем свежую сборку; E2E_APP_URL позволяет проверить уже запущенное приложение,
  // например открытое с сервера синхронизации по адресу в локальной сети.
  if (!process.env.E2E_APP_URL) {
    start(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(APP_PORT), '--strictPort'], { cwd: root })
  }
  await waitFor(appUrl, 'приложение (сначала нужен npm run build)')

  console.log(`Браузер: ${browserCommand}`)
  console.log('— Основной сценарий')
  // Подробный вывод сценария нужен только при разборе ошибок, поэтому итог печатаем сами.
  const flowCode = await runScenario('flow.mjs', shotsDir ? [shotsDir] : [])
  console.log(flowCode === 0 ? 'Основной сценарий пройден.' : 'Основной сценарий НЕ пройден.')

  console.log('— Обновление старой базы')
  const migrateCode = await runScenario('migrate.mjs')

  console.log('— Синхронизация')
  // Настоящий сервер на временной базе.
  const syncData = mkdtempSync(join(tmpdir(), 'finanse-e2e-server-'))
  const sync = createApp({ dataDir: syncData, webDir: null })
  await new Promise((ready) => sync.server.listen(SYNC_PORT, '127.0.0.1', ready))
  let syncCode
  try {
    syncCode = await runScenario('sync.mjs', [], { E2E_SYNC_URL: `http://localhost:${SYNC_PORT}`, E2E_SYNC_TOKEN: sync.token })
  } finally {
    await sync.close()
    rmSync(syncData, { recursive: true, force: true })
  }

  failed = flowCode !== 0 || migrateCode !== 0 || syncCode !== 0
} catch (error) {
  console.error(error.message)
  failed = true
} finally {
  stopAll()
}
process.exit(failed ? 1 : 0)
