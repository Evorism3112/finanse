# Установщик сервера синхронизации «Финансов» для Windows.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1               установить и запускать при входе в систему
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall    убрать автозапуск (база остаётся на месте)
#
# Нужен Node.js 24 или новее: https://nodejs.org
param(
  [int]$Port = 8787,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$Target = Join-Path $env:LOCALAPPDATA 'finanse-server'
$TaskName = 'FinanseServer'

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Автозапуск убран. База и ключ остались в $Target\data."
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  Write-Error 'Не найден Node.js. Установите Node.js 24 или новее: https://nodejs.org'
}
# Серверу нужен встроенный в Node.js модуль SQLite.
& $Node -e "require('node:sqlite')" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Нужен Node.js 24 или новее, а установлен $(& $Node --version)."
}

New-Item -ItemType Directory -Force -Path (Join-Path $Target 'data') | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'server.mjs'), (Join-Path $PSScriptRoot 'sync.mjs') -Destination $Target -Force

# Само приложение кладём рядом: тогда его можно открыть в браузере с любого устройства в сети.
$Web = @((Join-Path $PSScriptRoot 'web'), (Join-Path $PSScriptRoot '..\dist')) | Where-Object { Test-Path (Join-Path $_ 'index.html') } | Select-Object -First 1
if ($Web) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Target 'web') | Out-Null
  Copy-Item (Join-Path $Web '*') -Destination (Join-Path $Target 'web') -Recurse -Force
}

$env:FINANSE_DATA = Join-Path $Target 'data'
$Token = & $Node (Join-Path $Target 'server.mjs') --token

# Запуск при входе в систему, без окна консоли.
$Command = "`$env:FINANSE_PORT='$Port'; `$env:FINANSE_DATA='$Target\data'; `$env:FINANSE_WEB='$Target\web'; & '$Node' '$Target\server.mjs'"
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$Command`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

# Разрешаем входящие подключения из домашней сети. Без прав администратора правило не создастся.
try {
  New-NetFirewallRule -DisplayName 'Finanse server' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private -ErrorAction Stop | Out-Null
} catch {
  Write-Warning "Не удалось открыть порт $Port в брандмауэре. Запустите установщик от имени администратора или разрешите порт вручную."
}

Write-Host ''
Write-Host "Сервер «Финансов» установлен в $Target"
Write-Host ''
Write-Host "  Ключ доступа: $Token"
Write-Host '  Адрес для других устройств в этой сети:'
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host "    http://$($_.IPAddress):$Port" }
Write-Host "  На этом компьютере: http://localhost:$Port"
Write-Host ''
Write-Host 'В приложении: «Ещё» → «Синхронизация между устройствами» → введите адрес и ключ.'
