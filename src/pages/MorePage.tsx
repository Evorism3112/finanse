import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { exportBackup, importBackup, lastBackupAt, markBackupDone, restoreBackup } from '../backup'
import { ConfirmButton } from '../components/ConfirmButton'
import { ChevronLeftIcon, ChevronRightIcon, TagIcon } from '../components/Icons'
import { formatDate, isoDate, today } from '../dates'
import type { Data } from '../db'
import { downloadText } from '../download'
import { notifyState, requestNotifications, type NotifyState } from '../notify'
import { listSnapshots, saveManualSnapshot, type Snapshot } from '../snapshots'
import { connectSync, detectServer, disconnectSync, syncNow, useSyncStatus } from '../sync'
import { CategoriesPage } from './CategoriesPage'

const NOTIFY_TEXT: Record<NotifyState, string> = {
  granted: 'Уведомления включены.',
  default: 'Уведомления выключены.',
  denied: 'Уведомления запрещены в настройках браузера. Разрешите их для этого сайта, чтобы получать напоминания.',
  unsupported: 'Этот браузер не поддерживает уведомления. Напоминания видны только внутри приложения.',
}

export function MorePage({ onBackup, ...data }: Data & { onBackup: () => void }) {
  const [view, setView] = useState<'menu' | 'categories'>('menu')
  const [message, setMessage] = useState('')
  const [permission, setPermission] = useState(notifyState)
  const [backupAt, setBackupAt] = useState(lastBackupAt)

  const snapshots = useLiveQuery(listSnapshots)

  async function exportFile() {
    downloadText(`finanse-${today()}.json`, await exportBackup())
    markBackupDone()
    setBackupAt(lastBackupAt())
    onBackup()
  }

  /** Возвращает данные к автокопии; текущее состояние перед этим тоже сохраняется, чтобы шаг можно было отменить. */
  async function restore(snapshot: Snapshot) {
    try {
      await saveManualSnapshot(today())
      await restoreBackup(snapshot.data)
      setMessage(`Данные возвращены к копии от ${formatDate(snapshot.day)}. Состояние до восстановления сохранено в автокопиях.`)
    } catch (err) {
      setMessage(`Не удалось восстановить: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const count = await importBackup(await file.text())
      setMessage(count === 0 ? 'В файле нет ничего новее, чем на этом устройстве.' : `Обновлено записей: ${count}.`)
    } catch (err) {
      setMessage(`Не удалось импортировать: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (view === 'categories') {
    return (
      <>
        <button type="button" className="back" onClick={() => setView('menu')}>
          <ChevronLeftIcon />
          Назад
        </button>
        <CategoriesPage {...data} />
      </>
    )
  }

  return (
    <>
      <ul className="list">
        <li>
          <button type="button" className="row" onClick={() => setView('categories')}>
            <span className="avatar neutral">
              <TagIcon />
            </span>
            <span className="row-main">
              <span>Категории</span>
              <span className="muted">Доходы и расходы</span>
            </span>
            <span className="muted chevron">
              <ChevronRightIcon />
            </span>
          </button>
        </li>
      </ul>

      <div className="columns">
        <section className="card spaced">
          <h3>Напоминания</h3>
          <p className="muted">
            {NOTIFY_TEXT[permission]} Напоминания приходят, когда приложение открыто или запускается: без сервера браузер не
            может разбудить закрытое приложение.
          </p>
          {permission === 'default' && (
            <div className="actions">
              <button type="button" className="primary" onClick={async () => setPermission(await requestNotifications())}>
                Включить уведомления
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <h3>Резервная копия и перенос</h3>
          <p className="muted">
            Данные хранятся только на этом устройстве. Сохраните их в файл, чтобы не потерять или перенести на другое
            устройство. При импорте данные объединяются: если запись меняли на обоих устройствах, остаётся более поздняя
            версия.
          </p>
          <p className="hint">
            {backupAt ? `Последняя копия с этого устройства: ${formatDate(isoDate(new Date(backupAt)))}.` : 'Копия с этого устройства ещё не сохранялась.'}
          </p>
          <div className="actions">
            <button type="button" className="primary" onClick={exportFile}>
              Экспорт в файл
            </button>
            <label className="button">
              Импорт из файла
              <input type="file" accept="application/json,.json" hidden onChange={importFile} />
            </label>
          </div>
          {message && <p className="result">{message}</p>}
        </section>

        <SyncCard />

        <section className="card">
          <h3>Автокопии на этом устройстве</h3>
          <p className="muted">
            Раз в день приложение само сохраняет копию данных внутри браузера и хранит последние две недели. К такой
            копии можно вернуться после ошибочной правки. От очистки данных браузера она не спасёт — для этого нужен
            файл.
          </p>
          {snapshots && snapshots.length === 0 && <p className="hint">Автокопий пока нет: первая появится, когда будет что сохранять.</p>}
          {snapshots && snapshots.length > 0 && (
            <ul className="snapshots">
              {snapshots.map((snapshot) => (
                <li key={snapshot.at}>
                  <span className="row-main">
                    <span>
                      {formatDate(snapshot.day)}
                      {snapshot.kind === 'manual' ? ' · перед восстановлением' : ''}
                    </span>
                    <span className="muted">операций: {snapshot.transactions}</span>
                  </span>
                  <button type="button" className="chip" onClick={() => downloadText(`finanse-${snapshot.day}-autocopy.json`, snapshot.data)}>
                    Скачать
                  </button>
                  <ConfirmButton label="Вернуть" armedLabel="Заменить данные?" className="chip" onConfirm={() => restore(snapshot)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** Подключение к серверу синхронизации и её состояние. */
function SyncCard() {
  const status = useSyncStatus()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Если приложение открыто прямо с сервера, его адрес уже известен.
  useEffect(() => {
    if (!status.connected) void detectServer().then((found) => found && setUrl((current) => current || found))
  }, [status.connected])

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connectSync(url, token)
      setToken('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status.connected) {
    return (
      <section className="card">
        <h3>Синхронизация между устройствами</h3>
        <p className="muted">
          Подключите приложение к своему серверу, и данные будут одинаковыми на всех устройствах. Адрес и ключ сервер
          показывает при установке.
        </p>
        <form onSubmit={connect}>
          <label>
            Адрес сервера
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:8787" inputMode="url" autoCapitalize="none" />
          </label>
          <label>
            Ключ доступа
            <input value={token} onChange={(e) => setToken(e.target.value)} autoCapitalize="none" autoComplete="off" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Подключение…' : 'Подключить'}
            </button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="card">
      <h3>Синхронизация между устройствами</h3>
      <p className="muted">
        Подключено к {status.url}.{' '}
        {status.state === 'syncing'
          ? 'Идёт обмен…'
          : status.lastOk
            ? `Последняя синхронизация: ${formatDate(isoDate(new Date(status.lastOk)))} в ${timeFormat.format(status.lastOk)}.`
            : 'Обмена ещё не было.'}
      </p>
      {status.state === 'error' && <p className="error">{status.error}</p>}
      <div className="actions">
        <ConfirmButton label="Отключить" armedLabel="Точно отключить?" onConfirm={disconnectSync} />
        <button type="button" className="primary" disabled={status.state === 'syncing'} onClick={() => void syncNow().catch(() => {})}>
          Синхронизировать сейчас
        </button>
      </div>
    </section>
  )
}
