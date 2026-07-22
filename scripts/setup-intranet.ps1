. (Join-Path $PSScriptRoot "intranet-common.ps1")
Import-IntranetEnvironment

Write-Host "=== RWE-1 Windows intranet setup ==="
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "Node.js was not found. Install the Node.js LTS release first." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm.cmd was not found on PATH." }
if (-not (Get-Command py.exe -ErrorAction SilentlyContinue)) { throw "Python Launcher (py.exe) was not found." }
& py.exe -3.12 --version
if ($LASTEXITCODE -ne 0) { throw "Python 3.12 was not found." }

$python = Join-Path $script:Root ".venv\Scripts\python.exe"
if (Test-Path $python) {
    & $python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Removing an incompatible non-Python-3.12 virtual environment..."
        Remove-Item (Join-Path $script:Root ".venv") -Recurse -Force
    }
}
if (-not (Test-Path $python)) {
    Write-Host "Creating Python 3.12 virtual environment..."
    & py.exe -3.12 -m venv (Join-Path $script:Root ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python virtual environment." }
}

Write-Host "Installing backend dependencies..."
& $python -m pip install -r (Join-Path $script:Root "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed." }

$backendEnv = Join-Path $script:Root "backend\.env"
if (-not (Test-Path $backendEnv)) {
    Copy-Item (Join-Path $script:Root "backend\.env.example") $backendEnv
    Write-Host "Created backend\.env in mock mode. Add a real API key only on this workstation if needed."
}
$intranetEnv = Join-Path $script:Root ".env.intranet"
if (-not (Test-Path $intranetEnv)) {
    Copy-Item (Join-Path $script:Root ".env.intranet.example") $intranetEnv
}

Write-Host "Installing frontend dependencies..."
Push-Location (Join-Path $script:Root "frontend")
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed." }
    Write-Host "Building the Next.js production bundle..."
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }
} finally {
    Pop-Location
}

Write-Host "Setup completed successfully. Run start-intranet.cmd to start the workstation services."
