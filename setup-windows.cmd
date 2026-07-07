@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "PYTHON=%ROOT%.venv\Scripts\python.exe"

echo ==================================================
echo Reading Without Effort - Windows setup
echo ==================================================
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python Launcher "py" was not found.
  echo Install Python 3.12, then run this script again.
  goto :failed
)

py -3.12 --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python 3.12 was not found.
  echo This project should use Python 3.12 instead of Python 3.14.
  goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install the Node.js LTS version, then run this script again.
  goto :failed
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found.
  goto :failed
)

echo [1/4] Creating the root Python 3.12 virtual environment...
if exist "%PYTHON%" (
  "%PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo       Existing .venv is not Python 3.12 and will be recreated.
    echo       This avoids pydantic-core import errors caused by Python 3.14.
    rmdir /S /Q "%ROOT%.venv"
    if errorlevel 1 goto :failed
  ) else (
    echo       Existing Python 3.12 .venv will be reused.
  )
)
if not exist "%PYTHON%" (
  py -3.12 -m venv "%ROOT%.venv"
  if errorlevel 1 goto :failed
)

if exist "%BACKEND%\.venv\Scripts\python.exe" (
  "%BACKEND%\.venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo       Removing incompatible backend\.venv created by Python 3.14.
    rmdir /S /Q "%BACKEND%\.venv"
    if errorlevel 1 goto :failed
  )
)

echo [2/4] Installing backend dependencies...
"%PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :failed
"%PYTHON%" -m pip install -r "%BACKEND%\requirements-dev.txt"
if errorlevel 1 goto :failed

echo [3/4] Installing frontend dependencies...
pushd "%FRONTEND%"
call npm.cmd install
if errorlevel 1 (
  popd
  goto :failed
)
popd

echo [4/4] Creating local environment files when missing...
if not exist "%FRONTEND%\.env.local" (
  copy /Y "%FRONTEND%\.env.example" "%FRONTEND%\.env.local" >nul
)
if not exist "%BACKEND%\.env" (
  if exist "%ROOT%.env" (
    copy /Y "%ROOT%.env" "%BACKEND%\.env" >nul
    echo       backend\.env was copied from root .env.
  ) else (
    copy /Y "%BACKEND%\.env.example" "%BACKEND%\.env" >nul
    echo       backend\.env was created in Mock mode.
    echo       Add your own DeepSeek API key there if real AI calls are needed.
  )
)

echo.
echo [SUCCESS] Setup completed.
echo Run start-windows.cmd to open the frontend and backend.
echo.
pause
exit /b 0

:failed
echo.
echo [FAILED] Setup did not complete. Review the message above.
echo.
pause
exit /b 1
