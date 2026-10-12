#!/usr/bin/env node
// Сервер синхронизации «Финансов»: один файл базы SQLite, один ключ доступа, без внешних зависимостей.
// Заодно раздаёт само приложение, чтобы его можно было открыть с любого устройства в той же сети.
//
//   node server.mjs            запустить
//   node server.mjs --token    показать ключ доступа и выйти
//
// Настройки — переменными окружения: FINANSE_PORT (8787), FINANSE_DATA (папка с базой), FINANSE_WEB (папка с приложением),
// FINANSE_WEB=off — не раздавать приложение, только обмен данными;
// FINANSE_HOST (0.0.0.0; 127.0.0.1 — принимать запросы только с этого компьютера, когда перед сервером стоит HTTPS-прокси).
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, sync, SyncError } from './sync.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/** Больше этого одно устройство за раз не пришлёт: десятки тысяч операций занимают считаные мегабайты. */
const MAX_BODY = 32 * 1024 * 1024

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** Читает ключ доступа из папки с данными; при первом запуске создаёт его. */
export function loadToken(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  const file = join(dataDir, 'config.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).token
  const token = randomBytes(24).toString('base64url')
  writeFileSync(file, JSON.stringify({ token }, null, 2), { mode: 0o600 })
  return token
}

function sameToken(given, expected) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new SyncError('слишком большой запрос'))
        request.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

export function createApp({ dataDir, webDir }) {
  const token = loadToken(dataDir)
  const db = openDatabase(join(dataDir, 'finanse.sqlite'))
  const webRoot = webDir && existsSync(join(webDir, 'index.html')) ? resolve(webDir) : null

  const server = createServer(async (request, response) => {
    const send = (status, body, headers = {}) => {
      const json = typeof body === 'string' ? body : JSON.stringify(body)
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        // Доступ ограничен ключом, а не адресом страницы: приложение открывают и из браузера, и из установленной программы.
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Private-Network': 'true',
        ...headers,
      })
      response.end(json)
    }

    try {
      const url = new URL(request.url, 'http://server')
      if (request.method === 'OPTIONS') return send(204, '')

      if (url.pathname.startsWith('/api/')) {
        // Без ключа отвечаем только на вопрос «это сервер Финансов?» — он нужен, чтобы подсказать адрес в приложении.
        if (url.pathname === '/api/hello') return send(200, { app: 'finanse-server' })

        const given = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
        if (!sameToken(given, token)) return send(401, { error: 'неверный ключ доступа' })

        if (url.pathname === '/api/ping') return send(200, { ok: true })
        if (url.pathname === '/api/sync' && request.method === 'POST') {
          return send(200, sync(db, JSON.parse(await readBody(request))))
        }
        return send(404, { error: 'нет такого адреса' })
      }

      // Без приложения сервер только обменивается данными; на главной — короткая подсказка тому, кто открыл адрес в браузере.
      if (!webRoot && request.method === 'GET' && url.pathname === '/') {
        return send(200, 'Сервер «Финансов» работает. Этот адрес вводится в приложении: «Ещё» → «Синхронизация между устройствами».', { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      if (!webRoot || request.method !== 'GET') return send(404, { error: 'нет такого адреса' })
      // Приложение одностраничное: всё, что не файл, отдаёт index.html.
      let file = resolve(webRoot, `.${decodeURIComponent(url.pathname)}`)
      if (file !== webRoot && !file.startsWith(webRoot + sep)) return send(403, { error: 'запрещено' })
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(webRoot, 'index.html')
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        // Файлы с хешем в имени не меняются, остальное браузер должен перепроверять.
        'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      response.end(readFileSync(file))
    } catch (error) {
      if (error instanceof SyncError || error instanceof SyntaxError) return send(400, { error: error.message })
      console.error(error)
      send(500, { error: 'внутренняя ошибка сервера' })
    }
  })

  return {
    server,
    token,
    close: () =>
      new Promise((done) => {
        server.close(() => (db.close(), done()))
        // Иначе остановка ждала бы, пока браузеры сами закроют удерживаемые соединения.
        server.closeAllConnections()
      }),
  }
}

/** Адреса этого компьютера в локальной сети — их вводят на других устройствах. */
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = resolve(process.env.FINANSE_DATA ?? join(here, 'data'))
  // В папке проекта свежая сборка лежит в dist; в установленной копии её нет, там приложение в web.
  const webDir =
    process.env.FINANSE_WEB === 'off'
      ? null
      : resolve(process.env.FINANSE_WEB ?? (existsSync(join(here, '..', 'dist', 'index.html')) ? join(here, '..', 'dist') : join(here, 'web')))
  const port = Number(process.env.FINANSE_PORT ?? 8787)
  const host = process.env.FINANSE_HOST ?? '0.0.0.0'

  if (process.argv.includes('--token')) {
    console.log(loadToken(dataDir))
    process.exit(0)
  }

  const { server, token } = createApp({ dataDir, webDir })
  server.listen(port, host, () => {
    console.log('Сервер «Финансов» запущен.')
    console.log(`  Данные:       ${dataDir}`)
    console.log(`  Ключ доступа: ${token}`)
    if (host === '0.0.0.0') {
      console.log('  Адрес для других устройств в этой сети:')
      for (const address of lanAddresses()) console.log(`    http://${address}:${port}`)
    } else {
      console.log(`  Принимает запросы только на ${host} — снаружи доступен через HTTPS-прокси.`)
    }
    console.log(`  На этом компьютере: http://localhost:${port}`)
  })
}
