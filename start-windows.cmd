@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "PYTHON="
set "BACKEND_PY_REL=.\.venv\Scripts\python.exe"
set "ROOT_PY_REL=..\.venv\Scripts\python.exe"

rem Prefer the backend venv because this matches the manual command that works:
rem   cd backend
rem   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
if exist "%BACKEND%\.venv\Scripts\python.exe" set "PYTHON=%BACKEND_PY_REL%"
if not defined PYTHON if exist "%ROOT%.venv\Scripts\python.exe" set "PYTHON=%ROOT_PY_REL%"

echo ==================================================
echo Reading Without Effort - Start services
echo ==================================================
echo.

if not defined PYTHON (
  echo [ERROR] Backend virtual environment was not found.
  echo Recommended from project root:
  echo   cd backend
  echo   py -3.12 -m venv .venv
  echo   .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
  goto :failed
)

echo Using backend Python command: %PYTHON%
pushd "%BACKEND%"
%PYTHON% -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>nul
if errorlevel 1 (
  popd
  echo [ERROR] Backend virtual environment is not Python 3.12.
  echo Python 3.14 can install an incomplete pydantic-core wheel and make FastAPI fail to start.
  echo Recommended fix from project root:
  echo   cd backend
  echo   rmdir /S /Q .venv
  echo   py -3.12 -m venv .venv
  echo   .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
  goto :failed
)
popd

if not exist "%FRONTEND%\node_modules" (
  echo [ERROR] Frontend dependencies were not found.
  echo Double-click setup-windows.cmd first.
  goto :failed
)

if not exist "%FRONTEND%\.env.local" (
  copy /Y "%FRONTEND%\.env.example" "%FRONTEND%\.env.local" >nul
)

if not exist "%BACKEND%\.env" (
  if exist "%ROOT%.env" copy /Y "%ROOT%.env" "%BACKEND%\.env" >nul
)

echo Opening the backend window at http://localhost:8000 ...
start "Reading Without Effort - Backend" cmd /k ^
  "cd /d ""%BACKEND%"" && %PYTHON% -m uvicorn app.main:app --reload --port 8000"

echo Opening the frontend window at http://localhost:3000 ...
start "Reading Without Effort - Frontend" cmd /k ^
  "cd /d ""%FRONTEND%"" && npm.cmd run dev"

echo.
echo Two command windows have been opened.
echo Keep both windows open while using the application.
echo Close them or press Ctrl+C in each window to stop the services.
echo.
echo The browser will open in about 5 seconds...
timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"
exit /b 0

:failed
echo.
pause
exit /b 1