// Чтение файла выписки: CSV, Excel (.xlsx) или PDF — в таблицу или строки текста для statement.ts.
import { decodeText, parseCsv, parseStatementLines, parseStatementTable, type Statement } from './statement'

export async function readStatementFile(file: File): Promise<Statement> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = file.name.toLowerCase()
  const isPdf = name.endsWith('.pdf') || startsWith(bytes, [0x25, 0x50, 0x44, 0x46])
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
  if (isPdf) return parseStatementLines(await pdfLines(bytes))
  if (isZip) return parseStatementTable(await xlsxTable(bytes))
  if (name.endsWith('.xls') || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new Error('Старый формат Excel (.xls) не поддерживается. Сохраните файл как .xlsx или CSV, или выгрузите выписку в PDF.')
  }
  return parseStatementTable(parseCsv(decodeText(bytes)))
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b)

// --- Excel -------------------------------------------------------------------------------

/** Первый лист книги .xlsx в виде таблицы строк. */
export async function xlsxTable(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes)
  const text = (path: string) => {
    const f = files.get(path)
    return f ? new TextDecoder().decode(f) : null
  }
  const sheetPath =
    firstSheetPath(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels')) ??
    [...files.keys()].filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort()[0]
  const sheet = sheetPath ? text(sheetPath) : null
  if (!sheet) throw new Error('В книге Excel не нашли листов')

  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]))
  const rows: string[][] = []
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]
      const body = cell[2] ?? ''
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]
      const col = ref ? columnIndex(ref) : row.length
      const type = /t="([^"]+)"/.exec(attrs)?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
      let value: string
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = xmlText(body)
      else if (type === 'str' || type === 'b' || type === 'e') value = unescapeXml(v)
      // Числа в Excel хранятся с погрешностью двоичной дроби: 1240.4999999 — это 1240,50.
      else value = /^-?\d+\.\d{3,}/.test(v) ? Number(v).toFixed(2) : v
      row[col] = value
    }
    rows.push(Array.from(row, (c) => (c ?? '').trim()))
  }
  return rows.filter((r) => r.some(Boolean))
}

function firstSheetPath(workbook: string | null, rels: string | null): string | null {
  if (!workbook || !rels) return null
  const rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(workbook)?.[1]
  if (!rid) return null
  const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ??
    new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1]
  if (!target) return null
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`
}

function columnIndex(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

const xmlText = (xml: string) => unescapeXml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

/** Распаковывает ZIP (а .xlsx — это ZIP) средствами браузера, без сторонних библиотек. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('Файл повреждён: это не книга Excel')

  const count = view.getUint16(end + 10, true)
  let p = view.getUint32(end + 16, true)
  const files = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Файл повреждён: это не книга Excel')
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLength = view.getUint16(p + 28, true)
    const extraLength = view.getUint16(p + 30, true)
    const commentLength = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength))
    p += 46 + nameLength + extraLength + commentLength

    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + size)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, await inflate(data))
  }
  return files
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// --- PDF ---------------------------------------------------------------------------------

/** Текст PDF по строкам: кусочки текста с одной высотой на странице собираются в строку слева направо. */
async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  // pdf.js большой, поэтому грузится только при открытии PDF.
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  let doc
  try {
    doc = await pdfjs.getDocument({ data: bytes }).promise
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') throw new Error('PDF защищён паролем. Выгрузите выписку без пароля.')
    throw new Error('Не удалось открыть PDF')
  }

  const lines: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const pieces: { x: number; y: number; w: number; s: string }[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      pieces.push({ x: item.transform[4], y: item.transform[5], w: item.width, s: item.str })
    }
    pieces.sort((a, b) => b.y - a.y || a.x - b.x)
    const rows: (typeof pieces)[] = []
    for (const piece of pieces) {
      const row = rows.find((r) => Math.abs(r[0].y - piece.y) < 2.5)
      if (row) row.push(piece)
      else rows.push([piece])
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
      lines.push(row.map((p) => p.s).join(' '))
    }
  }
  if (lines.length === 0) throw new Error('В PDF нет текста — похоже, это скан. Нужна выписка, выгруженная из приложения банка.')
  return lines
}
