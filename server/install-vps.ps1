# Установщик «Финансов» на сервер с Windows (VPS).
#
# Ставит сервер синхронизации с базой и само приложение, запускает их в фоне при старте Windows
# и включает HTTPS, чтобы приложением можно было пользоваться из интернета — с компьютера и с телефона.
#
# Обычно запускается из меню Finanse.cmd. Напрямую, от имени администратора:
#   powershell -ExecutionPolicy Bypass -File install-vps.ps1                       обычная установка
#   powershell -ExecutionPolicy Bypass -File install-vps.ps1 -Domain my.site.ru    со своим доменом (он уже должен указывать на этот сервер)
#   powershell -ExecutionPolicy Bypass -File install-vps.ps1 -NoHttps              без HTTPS, только http://адрес:8787 — для закрытой сети
#   powershell -ExecutionPolicy Bypass -File install-vps.ps1 -Uninstall            убрать службы и правила брандмауэра (база остаётся)
#
# Без своего домена используется бесплатное имя вида 1-2-3-4.sslip.io: оно указывает на адрес 1.2.3.4,
# и на него выпускается обычный сертификат Let's Encrypt.
param(
  [string]$Domain = '',
  [int]$Port = 8787,
  [switch]$NoHttps,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Target = Join-Path $env:ProgramData 'finanse-server'
$ServerTask = 'FinanseServer'
$ProxyTask = 'FinanseHttps'
$Rules = @('Finanse HTTP', 'Finanse HTTPS', 'Finanse server')

# --- права администратора: без них не создать службу и не открыть порты ---
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$IsAdmin = (New-Object Security.Principal.WindowsPrincipal $Identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
  Write-Host 'Нужны права администратора. Откройте Finanse.cmd — он запросит их сам.'
  exit 1
}

function Remove-Task([string]$Name) {
  Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
}

# Остановка задачи не всегда завершает запущенную ею программу, а работающий файл нельзя заменить новым.
function Stop-Workers {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'caddy.exe'" |
    Where-Object { $_.CommandLine -like "*$Target*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# Фоновая задача: стартует вместе с Windows от имени системы, без окна и без входа пользователя;
# если программа упала — перезапускается.
function Register-Background([string]$Name, [string]$Script) {
  Remove-Task $Name
  $Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Script`""
  $Trigger = New-ScheduledTaskTrigger -AtStartup
  $Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
  Start-ScheduledTask -TaskName $Name
}

function Open-Port([string]$Name, [int]$LocalPort) {
  Remove-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort $LocalPort -Action Allow | Out-Null
}

if ($Uninstall) {
  Remove-Task $ServerTask
  Remove-Task $ProxyTask
  Stop-Workers
  foreach ($Rule in $Rules) { Remove-NetFirewallRule -DisplayName $Rule -ErrorAction SilentlyContinue }
  Write-Host "Службы и правила брандмауэра убраны. База и ключ остались в $Target\data."
  exit 0
}

# --- Node.js: серверу нужна версия со встроенным SQLite (24 и новее) ---
function Find-Node {
  $Candidates = @((Get-Command node -ErrorAction SilentlyContinue).Source, (Join-Path $env:ProgramFiles 'nodejs\node.exe'))
  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path $Candidate)) {
      & $Candidate -e "require('node:sqlite')" 2>$null
      if ($LASTEXITCODE -eq 0) { return $Candidate }
    }
  }
  return $null
}

$Node = Find-Node
if (-not $Node) {
  Write-Host 'Устанавливаю Node.js...'
  # Список сначала кладём в переменную: Windows PowerShell иначе передаёт его дальше одним куском, а не по записям.
  $Releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $Release = @($Releases) | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1
  if (-not $Release) { throw 'Не удалось узнать актуальную версию Node.js 24. Установите её вручную с https://nodejs.org и запустите установщик снова.' }
  $Msi = Join-Path $env:TEMP "node-$($Release.version)-x64.msi"
  Invoke-WebRequest "https://nodejs.org/dist/$($Release.version)/node-$($Release.version)-x64.msi" -OutFile $Msi -UseBasicParsing
  $Install = Start-Process msiexec.exe -ArgumentList "/i `"$Msi`" /qn /norestart" -Wait -PassThru
  if ($Install.ExitCode -ne 0) { throw "Установка Node.js завершилась с кодом $($Install.ExitCode)." }
  $Node = Find-Node
  if (-not $Node) { throw 'Node.js установлен, но не найден. Перезапустите установщик.' }
}
Write-Host "Node.js: $(& $Node --version)"

# --- файлы сервера и приложения ---
Remove-Task $ServerTask
Remove-Task $ProxyTask
Stop-Workers
New-Item -ItemType Directory -Force -Path (Join-Path $Target 'data') | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'server.mjs'), (Join-Path $PSScriptRoot 'sync.mjs') -Destination $Target -Force
$Web = Join-Path $PSScriptRoot 'web'
if (-not (Test-Path (Join-Path $Web 'index.html'))) { throw "Рядом с установщиком нет папки web с приложением. Распакуйте архив finanse-server целиком." }
if (Test-Path (Join-Path $Target 'web')) { Remove-Item (Join-Path $Target 'web') -Recurse -Force }
Copy-Item $Web -Destination (Join-Path $Target 'web') -Recurse -Force

$env:FINANSE_DATA = Join-Path $Target 'data'
$Token = & $Node (Join-Path $Target 'server.mjs') --token

# С HTTPS сервер слушает только сам компьютер, наружу его показывает прокси; без HTTPS — слушает всех.
$BindHost = '127.0.0.1'
if ($NoHttps) { $BindHost = '0.0.0.0' }
$RunServer = Join-Path $Target 'run-server.cmd'
@(
  '@echo off',
  "set FINANSE_PORT=$Port",
  "set FINANSE_HOST=$BindHost",
  "set FINANSE_DATA=$Target\data",
  "set FINANSE_WEB=$Target\web",
  "`"$Node`" `"$Target\server.mjs`" >> `"$Target\server.log`" 2>&1"
) | Set-Content -Path $RunServer -Encoding ASCII
Register-Background $ServerTask $RunServer

$Address = ''
$Notes = @()

if ($NoHttps) {
  Open-Port 'Finanse server' $Port
  $Ip = (Invoke-RestMethod 'https://api.ipify.org' -TimeoutSec 15).Trim()
  $Address = "http://${Ip}:$Port"
  $Notes += 'Соединение не шифруется: ключ и данные идут по сети открытым текстом. Используйте только в закрытой сети или через VPN.'
} else {
  # --- HTTPS: Caddy сам получает и продлевает сертификат ---
  if (-not $Domain) {
    $Ip = (Invoke-RestMethod 'https://api.ipify.org' -TimeoutSec 15).Trim()
    $Domain = ($Ip -replace '\.', '-') + '.sslip.io'
  }
  $CaddyDir = Join-Path $Target 'caddy'
  New-Item -ItemType Directory -Force -Path $CaddyDir | Out-Null
  $Caddy = Join-Path $CaddyDir 'caddy.exe'
  if (-not (Test-Path $Caddy)) {
    Write-Host 'Скачиваю Caddy (HTTPS-прокси)...'
    Invoke-WebRequest 'https://caddyserver.com/api/download?os=windows&arch=amd64' -OutFile $Caddy -UseBasicParsing
  }
  @(
    "$Domain {",
    '  encode gzip',
    "  reverse_proxy 127.0.0.1:$Port",
    '}'
  ) | Set-Content -Path (Join-Path $CaddyDir 'Caddyfile') -Encoding ASCII
  $RunProxy = Join-Path $CaddyDir 'run-caddy.cmd'
  @(
    '@echo off',
    "set XDG_DATA_HOME=$CaddyDir\data",
    "set XDG_CONFIG_HOME=$CaddyDir\config",
    "`"$Caddy`" run --config `"$CaddyDir\Caddyfile`" --adapter caddyfile >> `"$CaddyDir\caddy.log`" 2>&1"
  ) | Set-Content -Path $RunProxy -Encoding ASCII

  $Busy = Get-NetTCPConnection -State Listen -LocalPort 80, 443 -ErrorAction SilentlyContinue
  if ($Busy) { $Notes += 'Порт 80 или 443 уже занят другой программой (часто это IIS). Остановите её, иначе HTTPS не заработает.' }

  Open-Port 'Finanse HTTP' 80
  Open-Port 'Finanse HTTPS' 443
  Register-Background $ProxyTask $RunProxy
  $Address = "https://$Domain"

  # Сертификат выпускается при первом запуске — ждём, пока адрес начнёт отвечать.
  Write-Host 'Получаю сертификат HTTPS (до минуты)...'
  $Ready = $false
  for ($i = 0; $i -lt 30 -and -not $Ready; $i++) {
    Start-Sleep -Seconds 3
    try {
      $Hello = Invoke-RestMethod "$Address/api/hello" -TimeoutSec 5
      if ($Hello.app -eq 'finanse-server') { $Ready = $true }
    } catch { }
  }
  if (-not $Ready) {
    $Notes += "Адрес $Address пока не отвечает. Проверьте, что порты 80 и 443 открыты в панели управления VPS, и посмотрите $CaddyDir\caddy.log."
  }
}

$Summary = @(
  'Финансы установлены и работают в фоне.',
  '',
  "Адрес:        $Address",
  "Ключ доступа: $Token",
  '',
  'Как подключиться:',
  "  1. Откройте $Address в браузере на компьютере или телефоне.",
  '  2. В приложении: «Ещё» -> «Синхронизация между устройствами» -> введите ключ -> «Подключить».',
  '  3. На телефоне: меню браузера -> «Установить приложение» или «На главный экран».',
  '',
  "База и ключ: $Target\data",
  "Журнал:      $Target\server.log"
)
if ($Notes.Count -gt 0) { $Summary += ''; $Summary += 'Обратите внимание:'; $Summary += ($Notes | ForEach-Object { "  - $_" }) }

# Тот же текст сохраняем в файл: окно консоли закроется, а адрес и ключ ещё понадобятся.
$Summary | Set-Content -Path (Join-Path $Target 'connection.txt') -Encoding UTF8
Write-Host ''
$Summary | ForEach-Object { Write-Host $_ }
Write-Host ''
Write-Host "Эти сведения сохранены в $Target\connection.txt"
