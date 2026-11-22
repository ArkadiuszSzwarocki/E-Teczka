@echo off
setlocal
title E-Teczka - deweloperka desktop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0MojaTeczka-dev-desktop.ps1"
if errorlevel 1 pause
endlocal
