import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { closeTopWindow } from './useEscape'

/** true в приложении для Android, false в браузере и в настольной программе. */
export const isNative = Capacitor.isNativePlatform()

/** Что делает «Назад», когда окон нет; возвращает false, если делать нечего. Задаёт App: уводит на главную. */
let backHandler: () => boolean = () => false

export function setBackHandler(handler: () => boolean): void {
  backHandler = handler
}

/** Кнопка «Назад» на телефоне закрывает верхнее окно, иначе возвращает на главную, а с главной сворачивает приложение. */
export function initNativeShell(): void {
  if (!isNative) return
  void App.addListener('backButton', () => {
    if (!closeTopWindow() && !backHandler()) void App.minimizeApp()
  })
}
