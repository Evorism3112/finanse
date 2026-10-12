// Запускает сквозные проверки: поднимает собранное приложение и headless Firefox, прогоняет сценарии, всё гасит.
// Использование: npm run test:e2e [-- папка-для-скриншотов]. Нужен установленный Firefox.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const APP_PORT = 4199
const BIDI_PORT = 9333
const shotsDir = process.argv[2] ? resolve(process.argv[2]) : null

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
async function runScenario(script, args = []) {
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
  const firefox = start('firefox', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(BIDI_PORT)])
  try {
    await waitFor(`http://127.0.0.1:${BIDI_PORT}/`, 'Firefox')
    const scenario = spawn(process.execPath, [join(here, script), ...args], {
      stdio: 'inherit',
      env: { ...process.env, E2E_BIDI_PORT: String(BIDI_PORT), E2E_APP_URL: `http://localhost:${APP_PORT}/` },
    })
    return await new Promise((done) => scenario.on('exit', (code) => done(code ?? 1)))
  } finally {
    firefox.kill()
    children.splice(children.indexOf(firefox), 1)
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
  start(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(APP_PORT), '--strictPort'], { cwd: root })
  await waitFor(`http://localhost:${APP_PORT}/`, 'приложение (сначала нужен npm run build)')

  console.log('— Основной сценарий')
  // Подробный вывод сценария нужен только при разборе ошибок, поэтому итог печатаем сами.
  const flowCode = await runScenario('flow.mjs', shotsDir ? [shotsDir] : [])
  console.log(flowCode === 0 ? 'Основной сценарий пройден.' : 'Основной сценарий НЕ пройден.')

  console.log('— Обновление старой базы')
  const migrateCode = await runScenario('migrate.mjs')

  failed = flowCode !== 0 || migrateCode !== 0
} catch (error) {
  console.error(error.message)
  failed = true
} finally {
  stopAll()
}
process.exit(failed ? 1 : 0)
