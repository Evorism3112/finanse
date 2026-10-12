import { useSyncExternalStore } from 'react'
import { mergeRecords } from './backup'
import { db, type Synced } from './db'
import { normalizeRecords, type Records } from './merge'

// Синхронизация с домашним сервером (папка server/). Устройство отправляет свои правки и получает чужие;
// расхождения сводятся по правилу «побеждает последняя правка» — как при импорте копии.

const CONFIG_KEY = 'finanse:sync'
const TIMEOUT_MS = 15_000

interface SyncConfig {
  url: string
  token: string
  /** Номер изменения на сервере, до которого это устройство уже всё получило. */
  rev: number
  /** Время начала прошлого обмена по часам устройства: всё, что изменено позже, ещё не отправлено. */
  pushedAt: number
  lastOk: number | null
  /** Сколько записей ушло и пришло при последнем обмене — чтобы было видно, что он не пустой. */
  lastPushed?: number
  lastPulled?: number
}

export interface SyncStatus {
  connected: boolean
  url: string
  state: 'idle' | 'syncing' | 'error'
  error: string
  lastOk: number | null
  lastPushed: number
  lastPulled: number
}

function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? (JSON.parse(raw) as SyncConfig) : null
  } catch {
    return null
  }
}

function saveConfig(config: SyncConfig | null): void {
  if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  else localStorage.removeItem(CONFIG_KEY)
}

// --- состояние для интерфейса ---

const listeners = new Set<() => void>()
let status: SyncStatus = describe(loadConfig(), 'idle', '')

function describe(config: SyncConfig | null, state: SyncStatus['state'], error: string): SyncStatus {
  return {
    connected: config !== null,
    url: config?.url ?? '',
    state,
    error,
    lastOk: config?.lastOk ?? null,
    lastPushed: config?.lastPushed ?? 0,
    lastPulled: config?.lastPulled ?? 0,
  }
}

function setStatus(state: SyncStatus['state'], error = ''): void {
  status = describe(loadConfig(), state, error)
  for (const listener of listeners) listener()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
  )
}

// --- обмен с сервером ---

/** Приводит введённый адрес к виду http://хост:порт без хвостового слэша. Возвращает null, если это не адрес. */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
    if (!url.hostname) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Записи, изменённые на устройстве после прошлого обмена. */
export function changedSince<T extends Synced>(records: T[], pushedAt: number): T[] {
  return records.filter((r) => r.updatedAt > pushedAt)
}

async function request(config: Pick<SyncConfig, 'url' | 'token'>, path: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${config.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    // Страница по HTTPS не может обращаться к серверу по HTTP — браузер молча блокирует такой запрос.
    const blocked = location.protocol === 'https:' && config.url.startsWith('http://') && !/\/\/(localhost|127\.0\.0\.1)/.test(config.url)
    throw new Error(
      blocked
        ? 'Браузер заблокировал запрос: приложение открыто по HTTPS, а сервер работает по HTTP.'
        : 'Сервер недоступен. Проверьте адрес и что устройство в той же сети.',
    )
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 401) throw new Error('Неверный ключ доступа.')
  if (!response.ok) throw new Error(`Сервер ответил ошибкой ${response.status}.`)
  return response.json()
}

let running: Promise<void> | null = null

/**
 * Один обмен: отправить свои правки, получить и применить чужие. Параллельные вызовы сливаются в один.
 *
 * Обычный обмен передаёт только изменённое с прошлого раза. Полный (full) сверяет всё целиком:
 * он нужен после импорта копии — у её записей старое время изменения, и обычный обмен их не замечает, —
 * и служит кнопкой «починить», если устройства разошлись.
 */
export function syncNow(full = false): Promise<void> {
  if (running && full) {
    // Идущий обмен мог быть обычным — после него делаем полный.
    return running.catch(() => {}).then(() => syncNow(true))
  }
  running ??= exchange(full).finally(() => (running = null))
  return running
}

async function exchange(full: boolean): Promise<void> {
  const stored = loadConfig()
  if (!stored) return
  const config = full ? { ...stored, rev: 0, pushedAt: 0 } : stored
  setStatus('syncing')
  try {
    // Время берём до чтения базы: правка, сделанная во время обмена, уйдёт в следующий раз.
    const startedAt = Date.now()
    const changes: Records = {
      accounts: changedSince(await db.accounts.toArray(), config.pushedAt),
      categories: changedSince(await db.categories.toArray(), config.pushedAt),
      transactions: changedSince(await db.transactions.toArray(), config.pushedAt),
      subscriptions: changedSince(await db.subscriptions.toArray(), config.pushedAt),
    }
    const answer = (await request(config, '/api/sync', { since: config.rev, changes })) as { rev: number; changes: Records }
    const pulled = await mergeRecords(normalizeRecords(answer.changes))
    const pushed = changes.accounts.length + changes.categories.length + changes.transactions.length + changes.subscriptions.length
    // Конфигурацию могли сменить, пока шёл обмен, — тогда этот результат уже не про неё.
    const now = loadConfig()
    if (now && now.url === config.url && now.token === config.token) {
      saveConfig({ ...now, rev: answer.rev, pushedAt: startedAt, lastOk: Date.now(), lastPushed: pushed, lastPulled: pulled })
    }
    setStatus('idle')
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error))
    throw error
  }
}

/**
 * Разбирает то, что ввели в форму подключения. Адрес и ключ можно ввести по отдельности
 * или одной строкой «адрес#ключ» — её удобно переслать себе на телефон и вставить целиком.
 */
export function parseConnection(urlInput: string, tokenInput: string): { url: string | null; token: string } {
  const [address, ...rest] = urlInput.split('#')
  const fromLink = rest.join('#').trim()
  return { url: normalizeServerUrl(address), token: tokenInput.trim() || fromLink }
}

/** Подключает устройство к серверу: проверяет адрес и ключ, затем делает первый обмен. */
export async function connectSync(urlInput: string, tokenInput: string): Promise<void> {
  const { url, token } = parseConnection(urlInput, tokenInput)
  if (!url) throw new Error('Введите адрес сервера, например http://192.168.1.10:8787')
  if (!token.trim()) throw new Error('Введите ключ доступа')
  // Ключ сервера состоит из латинских букв и цифр; другое в заголовок запроса даже не поместится.
  if (/[^\x21-\x7e]/.test(token.trim())) throw new Error('Неверный ключ доступа.')
  const config = { url, token: token.trim(), rev: 0, pushedAt: 0, lastOk: null }
  await request(config, '/api/ping')
  saveConfig(config)
  await syncNow()
}

export function disconnectSync(): void {
  saveConfig(null)
  setStatus('idle')
}

/** Если приложение открыто прямо с сервера синхронизации, возвращает его адрес — чтобы подставить в форму. */
export async function detectServer(): Promise<string | null> {
  if (!location.protocol.startsWith('http')) return null
  try {
    const response = await fetch('/api/hello')
    const body = (await response.json()) as { app?: string }
    return body.app === 'finanse-server' ? location.origin : null
  } catch {
    return null
  }
}

let timer: ReturnType<typeof setTimeout> | undefined

/** Запланировать обмен: несколько правок подряд уходят одним запросом. Без подключения ничего не делает. */
export function scheduleSync(delayMs = 3000): void {
  if (!loadConfig()) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow().catch(() => {}), delayMs)
}
