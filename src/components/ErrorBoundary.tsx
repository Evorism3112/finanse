import { Component, type ErrorInfo, type ReactNode } from 'react'
import { exportBackup } from '../backup'
import { today } from '../dates'
import { downloadText } from '../download'
import { listSnapshots } from '../snapshots'

/**
 * Последний рубеж: если приложение упало, вместо пустого экрана показываем, что случилось,
 * и даём забрать данные — из базы, а если она недоступна, то из последней автокопии.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; note: string }> {
  state = { error: null as Error | null, note: '' }

  static getDerivedStateFromError(error: Error) {
    return { error, note: '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  rescue = async () => {
    try {
      downloadText(`finanse-${today()}.json`, await exportBackup())
      this.setState({ note: 'Копия данных сохранена в файл.' })
    } catch {
      try {
        const [latest] = await listSnapshots()
        if (!latest) throw new Error('нет автокопий')
        downloadText(`finanse-${latest.day}-autocopy.json`, latest.data)
        this.setState({ note: `База недоступна, сохранена автокопия за ${latest.day}.` })
      } catch {
        this.setState({ note: 'Не удалось прочитать ни базу, ни автокопии.' })
      }
    }
  }

  render() {
    const { error, note } = this.state
    if (!error) return this.props.children
    return (
      <main className="crash">
        <div className="card">
          <h2>Что-то пошло не так</h2>
          <p className="muted">
            Приложение столкнулось с ошибкой и остановилось. Данные при этом не удаляются. Сначала сохраните копию, потом
            перезагрузите страницу.
          </p>
          <p className="error">{error.message || String(error)}</p>
          {note && <p>{note}</p>}
          <div className="actions">
            <button type="button" onClick={this.rescue}>
              Сохранить копию данных
            </button>
            <button type="button" className="primary" onClick={() => location.reload()}>
              Перезагрузить
            </button>
          </div>
        </div>
      </main>
    )
  }
}
