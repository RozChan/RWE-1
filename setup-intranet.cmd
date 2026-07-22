@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-intranet.ps1"
if errorlevel 1 (
  echo.
  echo [FAILED] Intranet setup did not complete.
  pause
  exit /b 1
)
echo.
echo [SUCCESS] Intranet setup completed.
pause
