@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-intranet.ps1"
if errorlevel 1 echo [FAILED] Status check could not complete.
pause
