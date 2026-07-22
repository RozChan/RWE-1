@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-intranet.ps1"
if errorlevel 1 (
  echo.
  echo [FAILED] Intranet services did not start.
  pause
  exit /b 1
)
echo.
echo Services continue in the background. Use check-intranet.cmd or stop-intranet.cmd.
pause
