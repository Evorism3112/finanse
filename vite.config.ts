import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      // Открывает приложение по нажатию на уведомление.
      workbox: {
        importScripts: ['sw-notify.js'],
        // Обработчик PDF для импорта выписок — модуль .mjs больше 2 МБ по умолчанию не кэшируется; он нужен и без сети.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: 'Финансы',
        short_name: 'Финансы',
        description: 'Учёт личных финансов',
        lang: 'ru',
        display: 'standalone',
        theme_color: '#1f7a5c',
        background_color: '#f4f6f5',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
