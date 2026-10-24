import '@fontsource-variable/manrope'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import { initNativeShell } from './native.ts'
import { initNotifications } from './notify.ts'

// Просим браузер не вытеснять базу при нехватке места: данные лежат только на устройстве.
void navigator.storage?.persist?.()

initNativeShell()

// На телефоне сначала узнаём, разрешены ли уведомления: от этого зависит первый же экран.
void initNotifications().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})
