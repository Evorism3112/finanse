import { useEffect, useRef, useState, type FormEvent } from 'react'
import { answer, describeDraft, GREETING, clearQueuedQuestion, queuedQuestion, type Draft, type Reply } from '../assistant'
import { SendIcon, SparkIcon } from '../components/Icons'
import { db, deleted, newRecord, type Data, type Transaction } from '../db'
import { TxForm } from './TxForm'

interface Message {
  id: number
  from: 'me' | 'bot'
  text?: string
  reply?: Reply
  /** Что стало с черновиком операции: записан (id операции) или отменён после записи. */
  saved?: string
  cancelled?: boolean
}

// Переписка живёт, пока открыто приложение: переход на другую вкладку её не стирает.
let history: Message[] = [{ id: 0, from: 'bot', reply: GREETING }]
let nextId = 1

/** Вопрос и ответ на него — два сообщения переписки. */
function exchange(question: string, ctx: Data & { today: string }): Message[] {
  return [
    { id: nextId++, from: 'me', text: question },
    { id: nextId++, from: 'bot', reply: answer(question, ctx) },
  ]
}

export function AssistantPage({ day, ...data }: Data & { day: string }) {
  const ctx = { ...data, today: day }
  // Вопрос, с которым сюда пришли с другого экрана, сразу получает ответ.
  const [messages, setMessages] = useState(() => {
    const question = queuedQuestion()
    return question ? [...history, ...exchange(question, ctx)] : history
  })
  const [input, setInput] = useState('')
  const [editing, setEditing] = useState<{ messageId: number; draft: Draft } | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(clearQueuedQuestion, [])

  useEffect(() => {
    history = messages
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  function ask(text: string) {
    const question = text.trim()
    if (!question) return
    setMessages((list) => [...list, ...exchange(question, ctx)])
    setInput('')
  }

  function send(e: FormEvent) {
    e.preventDefault()
    ask(input)
  }

  const patch = (id: number, change: Partial<Message>) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...change } : m)))

  async function save(messageId: number, draft: Draft) {
    const record = newRecord<Transaction>(draft)
    await db.transactions.add(record)
    patch(messageId, { saved: record.id, cancelled: false })
  }

  async function undo(messageId: number, transactionId: string) {
    await db.transactions.update(transactionId, deleted())
    patch(messageId, { cancelled: true })
  }

  return (
    <div className="chat">
      <div className="chat-log" aria-live="polite">
        {messages.map((m) =>
          m.from === 'me' ? (
            <p key={m.id} className="bubble me">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className="bubble bot">
              <span className="bot-mark" aria-hidden="true">
                <SparkIcon />
              </span>
              <div className="bot-body">
                {m.reply!.text.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}

                {m.reply!.rows && m.reply!.rows.length > 0 && (
                  <ul className="chat-rows">
                    {m.reply!.rows.map((row, i) => (
                      <li key={i}>
                        <span className="row-main">
                          <span>{row.label}</span>
                          {row.hint && <span className="muted">{row.hint}</span>}
                        </span>
                        <span className="amount">{row.value}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {m.reply!.sections?.map((section) => (
                  <div key={section.title} className="chat-section">
                    <h3>{section.title}</h3>
                    <div className="chat-chips">
                      {section.items.map((item) => (
                        <button key={item} type="button" className="pill" onClick={() => ask(item)}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {m.reply!.draft && <DraftCard message={m} ctx={ctx} onSave={save} onUndo={undo} onEdit={(draft) => setEditing({ messageId: m.id, draft })} />}

                {m.reply!.chips && m.reply!.chips.length > 0 && (
                  <div className="chat-chips">
                    {m.reply!.chips.map((chip) => (
                      <button key={chip} type="button" className="pill" onClick={() => ask(chip)}>
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={end} className="chat-end" />
      </div>

      <form className="chat-input" onSubmit={send}>
        <label className="visually-hidden" htmlFor="assistant-input">
          Сообщение помощнику
        </label>
        <input
          id="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="кофе 250 или «сколько потратил на кафе»"
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="primary" aria-label="Отправить" disabled={!input.trim()}>
          <SendIcon />
        </button>
      </form>

      {editing && (
        <TxForm
          tx={null}
          draft={editing.draft}
          accounts={data.accounts}
          categories={data.categories}
          transactions={data.transactions}
          onClose={() => setEditing(null)}
          onSaved={(id) => patch(editing.messageId, { saved: id, cancelled: false })}
        />
      )}
    </div>
  )
}

function DraftCard({
  message,
  ctx,
  onSave,
  onUndo,
  onEdit,
}: {
  message: Message
  ctx: Data & { today: string }
  onSave: (messageId: number, draft: Draft) => void
  onUndo: (messageId: number, transactionId: string) => void
  onEdit: (draft: Draft) => void
}) {
  const draft = message.reply!.draft!
  const { title, amount, details } = describeDraft(draft, ctx)
  const saved = message.saved && !message.cancelled
  return (
    <div className="draft">
      <div className="draft-head">
        <span className="row-main">
          <span>{title}</span>
          <span className="muted wrap">{details}</span>
        </span>
        <span className={`amount ${draft.type === 'expense' ? '' : draft.type}`}>{amount}</span>
      </div>
      {saved ? (
        <div className="draft-actions">
          <span className="draft-status">Записано</span>
          <button type="button" className="chip" onClick={() => onUndo(message.id, message.saved!)}>
            Отменить
          </button>
        </div>
      ) : (
        <div className="draft-actions">
          {message.cancelled && <span className="draft-status muted">Отменено</span>}
          <button type="button" className="chip" onClick={() => onEdit(draft)}>
            Изменить
          </button>
          <button type="button" className="chip strong" onClick={() => onSave(message.id, draft)}>
            Записать
          </button>
        </div>
      )}
    </div>
  )
}
