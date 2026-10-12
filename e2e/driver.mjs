// Управление браузером для сценариев. Firefox понимает WebDriver BiDi, браузеры на Chromium — CDP;
// наружу оба отдают одно и то же: открыть страницу, выполнить код, задать размер окна, снять экран.
const PORT = process.env.E2E_BIDI_PORT ?? '9333'
export const APP_URL = process.env.E2E_APP_URL ?? 'http://localhost:4199/'

function rpc(ws, onEvent) {
  let nextId = 1
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(typeof msg.error === 'string' ? `${msg.error}: ${msg.message}` : msg.error.message))
      else resolve(msg.result)
    } else if (msg.method) {
      onEvent?.(msg)
    }
  }
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
}

function open(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error(`нет соединения с браузером: ${url}`))
  })
}

async function connectBidi() {
  const ws = await open(`ws://127.0.0.1:${PORT}/session`)
  const send = rpc(ws)
  await send('session.new', { capabilities: {} })
  const context = (await send('browsingContext.getTree')).contexts[0].context
  return {
    navigate: (url) => send('browsingContext.navigate', { context, url, wait: 'complete' }),
    async evaluate(expression) {
      const res = await send('script.evaluate', { expression, target: { context }, awaitPromise: true })
      if (res.type === 'exception') throw new Error(res.exceptionDetails.text)
      return res.result.value
    },
    setViewport: (width, height) => send('browsingContext.setViewport', { context, viewport: { width, height } }),
    screenshot: async () => Buffer.from((await send('browsingContext.captureScreenshot', { context })).data, 'base64'),
    close: () => ws.close(),
  }
}

async function connectCdp() {
  // Открываем свою вкладку: стартовую браузер может сам увести на страницу приветствия.
  const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = await open(page.webSocketDebuggerUrl)
  // Загрузку отслеживаем по номеру именно нашего перехода: иначе за неё легко принять
  // событие от предыдущей страницы и начать работать с документом, который вот-вот сменится.
  const loaded = new Set()
  let onLoad = null
  const send = rpc(ws, (event) => {
    if (event.method !== 'Page.lifecycleEvent' || event.params.name !== 'load') return
    loaded.add(event.params.loaderId)
    onLoad?.()
  })
  await send('Page.enable')
  await send('Page.setLifecycleEventsEnabled', { enabled: true })
  // Экспорт копии не должен писать в «Загрузки» пользователя.
  if (process.env.E2E_DOWNLOAD_DIR) {
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: process.env.E2E_DOWNLOAD_DIR })
  }
  return {
    async navigate(url) {
      const { loaderId, errorText } = await send('Page.navigate', { url })
      if (errorText) throw new Error(`не открылась страница ${url}: ${errorText}`)
      while (!loaded.has(loaderId)) await new Promise((resolve) => (onLoad = resolve))
      // Сразу после запуска браузер иногда сообщает о загрузке раньше, чем документ готов к работе.
      for (let i = 0; i < 100; i++) {
        const ready = await send('Runtime.evaluate', { expression: `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, returnByValue: true })
        if (ready.result?.value === true) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error(`страница ${url} не загрузилась`)
    },
    async evaluate(expression) {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
      return res.result.value
    },
    setViewport: (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
    screenshot: async () => Buffer.from((await send('Page.captureScreenshot')).data, 'base64'),
    close: () => ws.close(),
  }
}

export const connect = () => (process.env.E2E_PROTOCOL === 'cdp' ? connectCdp() : connectBidi())
