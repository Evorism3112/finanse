import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { closeTopWindow } from './useEscape'

/** true в приложении для Android, false в браузере и в настольной программе. */
export const isNative = Capacitor.isNativePlatform()

/** Кнопка «Назад» на телефоне закрывает верхнее окно, а если окон нет — сворачивает приложение. */
export function initNativeShell(): void {
  if (!isNative) return
  void App.addListener('backButton', () => {
    if (!closeTopWindow()) void App.minimizeApp()
  })
}
