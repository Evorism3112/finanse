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
    Get-Content $Info -Encoding UTF8 | Where-Object { $_ -match '^(Адрес|Ключ доступа|Строка подключения):' } | ForEach-Object { Write-Host $_ }
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

# Сведения для разбора неполадок: кто занимает порты, что с задачами и что в журналах.
function Show-Diagnostics {
  foreach ($LocalPort in 80, 443, 8787) {
    $Ids = @(Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    $Names = foreach ($Id in $Ids) { if ($Id -eq 4) { 'IIS (веб-сервер Windows)' } else { (Get-Process -Id $Id -ErrorAction SilentlyContinue).ProcessName } }
    $Owner = (@($Names) | Where-Object { $_ }) -join ', '
    if (-not $Owner) { $Owner = 'свободен' }
    Write-Host "Порт ${LocalPort}: $Owner"
  }
  Write-Host ''
  $Found = @(Get-Tasks)
  if ($Found.Count -eq 0) { Write-Host 'Задачи: не созданы' }
  $Found | ForEach-Object { Write-Host "Задача $($_.TaskName): $($_.State)" }
  foreach ($Log in 'server.log', 'caddy\caddy.log') {
    $Path = Join-Path $Target $Log
    if (Test-Path $Path) {
      Write-Host ''
      Write-Host "--- последние строки $Log ---"
      Get-Content $Path -Tail 12 -Encoding UTF8 | ForEach-Object { Write-Host $_ }
    }
  }
}

function Install-All {
  Write-Host 'Как установить:'
  Write-Host '  1 - только база для установленных приложений (адрес вида http://IP:8787).'
  Write-Host '      Подходит, если на сервере уже есть сайт: порты 80 и 443 не нужны.'
  Write-Host '  2 - база и приложение в браузере по HTTPS (нужны свободные порты 80 и 443).'
  $Mode = (Read-Host 'Выберите 1 или 2').Trim()
  if ($Mode -eq '1') {
    & $Installer -ApiOnly
  } elseif ($Mode -eq '2') {
    $Domain = Read-Host 'Свой домен (просто Enter, если домена нет)'
    if ($Domain.Trim()) { & $Installer -Domain $Domain.Trim() } else { & $Installer }
  } else {
    Write-Host 'Такого варианта нет.' -ForegroundColor Yellow
  }
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
  Write-Host '  6. Диагностика'
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
      '6' { Show-Diagnostics }
      '0' { exit 0 }
      default { Write-Host 'Такого пункта нет.' -ForegroundColor Yellow }
    }
  } catch {
    Write-Host "Ошибка: $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ''
  Read-Host 'Enter — вернуться в меню' | Out-Null
}
