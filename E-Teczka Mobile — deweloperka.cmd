@echo off
setlocal
title E-Teczka Mobile — deweloperka
set "MOBILE_DIR=A:\GitHub\E-Teczka\ETeczkaMobile"
set "TEMP=A:\ETeczkaTemp"
set "TMP=A:\ETeczkaTemp"

if not exist "%MOBILE_DIR%\package.json" (
  echo Nie znaleziono projektu: %MOBILE_DIR%
  pause
  exit /b 1
)

if not exist "%TEMP%" mkdir "%TEMP%"
adb reverse tcp:8081 tcp:8081 >nul 2>nul
cd /d "%MOBILE_DIR%"
npx expo start --dev-client --localhost --clear --port 8081
endlocal
