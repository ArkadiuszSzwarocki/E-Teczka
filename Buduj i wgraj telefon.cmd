@echo off
setlocal
title E-Teczka - budowanie i instalacja na telefonie
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Buduj i wgraj telefon.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Nie udalo sie zakonczyc operacji. Sprawdz komunikat powyzej.
pause
exit /b %RESULT%
