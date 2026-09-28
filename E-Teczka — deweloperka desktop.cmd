@echo off
setlocal
title E-Teczka — deweloperka desktop
set "APP_DIR=A:\GitHub\E-Teczka"

if not exist "%APP_DIR%\package.json" (
  echo Nie znaleziono projektu: %APP_DIR%
  pause
  exit /b 1
)

cd /d "%APP_DIR%"
npm run dev:desktop
endlocal
