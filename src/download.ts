import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './native'

/**
 * Отдаёт текст пользователю как файл. В браузере и настольной программе это обычное скачивание;
 * на телефоне скачиваний нет, поэтому файл открывается в системном окне «Поделиться» —
 * оттуда его можно сохранить в файлы или отправить себе.
 */
export async function downloadText(name: string, text: string, type = 'application/json'): Promise<void> {
  if (isNative) {
    const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
    try {
      await Share.share({ title: name, url: uri, dialogTitle: 'Сохранить копию данных' })
    } catch {
      // Окно закрыли, ничего не выбрав, — это не ошибка.
    }
    return
  }
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
