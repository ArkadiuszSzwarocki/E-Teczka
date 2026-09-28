@echo off
setlocal
title E-Teczka

set "APP_DIR=A:\GitHub\E-Teczka"
set "ELECTRON=%APP_DIR%\node_modules\electron\dist\electron.exe"

if not exist "%APP_DIR%\frontend\dist\index.html" (
  echo Brakuje zbudowanego frontendu E-Teczki.
  echo Uruchom: cd /d "%APP_DIR%\frontend" ^&^& npm run build
  pause
  exit /b 1
)

if not exist "%ELECTRON%" (
  echo Brakuje programu Electron: %ELECTRON%
  echo Uruchom: cd /d "%APP_DIR%" ^&^& npm install
  pause
  exit /b 1
)

start "E-Teczka" /D "%APP_DIR%" "%ELECTRON%" "%APP_DIR%"
endlocal
