@echo off
rem Finanse installer for a Windows server. Run as administrator.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-vps.ps1" %*
echo.
pause
