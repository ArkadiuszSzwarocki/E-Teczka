@echo off
setlocal
title MojaTeczka Mobile — deweloperka
set "MOBILE_DIR=%~dp0MojaTeczkaMobile"
set "GRADLE_USER_HOME=%~dp0.local\gradle"
set "TEMP=%~dp0.local\temp"
set "TMP=%TEMP%"

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
