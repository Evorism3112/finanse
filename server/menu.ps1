# Меню управления «Финансами» на сервере с Windows. Открывается файлом Finanse.cmd.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'Финансы — сервер'

$Target = Join-Path $env:ProgramData 'finanse-server'
$Tasks = @('FinanseServer', 'FinanseHttps')
$Installer = Join-Path $PSScriptRoot 'install-vps.ps1'

function Get-Tasks {
  $Tasks | ForEach-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue }
}

# Фоновые процессы сервера и HTTPS-прокси: их узнаём по папке установки в строке запуска.
function Get-Workers {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'caddy.exe'" | Where-Object { $_.CommandLine -like "*$Target*" }
}

function Show-Status {
  $Found = @(Get-Tasks)
  if ($Found.Count -eq 0) {
    Write-Host 'Состояние: не установлено' -ForegroundColor Yellow
    return
  }
  if (@(Get-Workers).Count -gt 0) {
    Write-Host 'Состояние: работает в фоне' -ForegroundColor Green
  } else {
    Write-Host 'Состояние: установлено, но остановлено' -ForegroundColor Yellow
  }
  $Info = Join-Path $Target 'connection.txt'
  if (Test-Path $Info) {
    Get-Content $Info -Encoding UTF8 | Where-Object { $_ -match '^(Адрес|Ключ доступа):' } | ForEach-Object { Write-Host $_ }
  }
}

function Start-All {
  $Found = @(Get-Tasks)
  if ($Found.Count -eq 0) { Write-Host 'Сначала выполните установку (пункт 1).' -ForegroundColor Yellow; return }
  $Found | ForEach-Object { Start-ScheduledTask -TaskName $_.TaskName }
  Start-Sleep -Seconds 2
  Write-Host 'Запущено. Сервер работает в фоне, это окно можно закрыть.' -ForegroundColor Green
}

function Stop-All {
  Get-Tasks | ForEach-Object { Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue }
  Get-Workers | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host 'Остановлено. После перезагрузки Windows сервер запустится снова — чтобы этого не было, удалите службы (пункт 5).'
}

function Install-All {
  $Domain = Read-Host 'Свой домен (просто Enter, если домена нет)'
  if ($Domain.Trim()) { & $Installer -Domain $Domain.Trim() } else { & $Installer }
}

while ($true) {
  Clear-Host
  Write-Host '=== Финансы — сервер ===' -ForegroundColor Cyan
  Write-Host ''
  Show-Status
  Write-Host ''
  Write-Host '  1. Установить или обновить'
  Write-Host '  2. Запустить'
  Write-Host '  3. Остановить'
  Write-Host '  4. Показать адрес и ключ'
  Write-Host '  5. Удалить службы (база останется)'
  Write-Host '  0. Выход'
  Write-Host ''
  $Choice = Read-Host 'Выберите пункт'
  Write-Host ''
  try {
    switch ($Choice.Trim()) {
      '1' { Install-All }
      '2' { Start-All }
      '3' { Stop-All }
      '4' {
        $Info = Join-Path $Target 'connection.txt'
        if (Test-Path $Info) { Get-Content $Info -Encoding UTF8 | ForEach-Object { Write-Host $_ } } else { Write-Host 'Сервер ещё не установлен.' -ForegroundColor Yellow }
      }
      '5' { Stop-All; & $Installer -Uninstall }
      '0' { exit 0 }
      default { Write-Host 'Такого пункта нет.' -ForegroundColor Yellow }
    }
  } catch {
    Write-Host "Ошибка: $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ''
  Read-Host 'Enter — вернуться в меню' | Out-Null
}
