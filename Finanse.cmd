@echo off
rem Finanse server menu for Windows: install, start, stop. Double-click to open.
rem Asks for administrator rights itself.
fltmc >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "SCRIPT=%~dp0menu.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0server\menu.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
