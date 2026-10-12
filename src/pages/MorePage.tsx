import { useState, type ChangeEvent } from 'react'
import { exportBackup, importBackup, lastBackupAt, markBackupDone } from '../backup'
import { ChevronLeftIcon, ChevronRightIcon, TagIcon } from '../components/Icons'
import { formatDate, isoDate, today } from '../dates'
import type { Data } from '../db'
import { notifyState, requestNotifications, type NotifyState } from '../notify'
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

  async function exportFile() {
    const url = URL.createObjectURL(new Blob([await exportBackup()], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `finanse-${today()}.json`
    link.click()
    URL.revokeObjectURL(url)
    markBackupDone()
    setBackupAt(lastBackupAt())
    onBackup()
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
          <h3>Напоминания о подписках</h3>
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
      </div>
    </>
  )
}
