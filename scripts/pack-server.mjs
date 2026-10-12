// Собирает сервер синхронизации в одну папку, которую можно унести на другой компьютер:
// release/finanse-server/ — сам сервер, установщики и собранное приложение в web/.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'release', 'finanse-server')

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('Сначала соберите приложение: npm run build')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const file of ['server.mjs', 'sync.mjs', 'install.sh', 'install.ps1']) cpSync(join(root, 'server', file), join(out, file))
cpSync(join(root, 'dist'), join(out, 'web'), { recursive: true })

// Архив — для переноса одним файлом. Пробуем то, что есть в системе; если ничего нет, остаётся просто папка.
const release = join(root, 'release')
const attempts = [
  ['finanse-server.zip', 'zip', ['-qr', 'finanse-server.zip', 'finanse-server']],
  // bsdtar (он же tar в Windows) умеет zip, обычный GNU tar — нет.
  ['finanse-server.zip', 'bsdtar', ['-a', '-cf', 'finanse-server.zip', 'finanse-server']],
  ['finanse-server.tar.gz', 'tar', ['-czf', 'finanse-server.tar.gz', 'finanse-server']],
]
for (const [name] of attempts) rmSync(join(release, name), { force: true })
let archive = null
for (const [name, command, args] of attempts) {
  try {
    execFileSync(command, args, { cwd: release, stdio: 'ignore' })
    archive = join(release, name)
    break
  } catch {
    rmSync(join(release, name), { force: true })
  }
}

console.log(`Сервер собран: ${out}`)
console.log(archive ? `Архив: ${archive}` : 'Архиватор не найден — архив не создан.')
