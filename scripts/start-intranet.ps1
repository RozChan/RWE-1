. (Join-Path $PSScriptRoot "intranet-common.ps1")
Import-IntranetEnvironment
New-Item -ItemType Directory -Force -Path $script:Logs | Out-Null

$backendPidFile = Join-Path $script:Logs "backend.pid"
$frontendPidFile = Join-Path $script:Logs "frontend.pid"
if ((Test-ProjectPid $backendPidFile) -or (Test-ProjectPid $frontendPidFile)) {
    throw "A project service is already running according to the PID files. Run check-intranet.cmd or stop-intranet.cmd first."
}
if (Test-ListeningPort ([int]$env:BACKEND_PORT)) { throw "Backend port $env:BACKEND_PORT is already occupied. Nothing was started." }
if (Test-ListeningPort ([int]$env:FRONTEND_PORT)) { throw "Frontend port $env:FRONTEND_PORT is already occupied. Nothing was started." }

$python = Join-Path $script:Root ".venv\Scripts\python.exe"
$buildId = Join-Path $script:Root "frontend\.next\BUILD_ID"
if (-not (Test-Path $python)) { throw "Python environment is missing. Run setup-intranet.cmd first." }
if (-not (Test-Path $buildId)) { throw "Next.js production build is missing. Run setup-intranet.cmd first." }

$backendLog = Join-Path $script:Logs "backend.log"
$frontendLog = Join-Path $script:Logs "frontend.log"
$backendDir = Join-Path $script:Root "backend"
$frontendDir = Join-Path $script:Root "frontend"
$backendCommand = "cd /d `"$backendDir`" && `"$python`" -m uvicorn app.main:app --host $env:BACKEND_HOST --port $env:BACKEND_PORT >> `"$backendLog`" 2>&1"
$backendProcess = Start-Process cmd.exe -ArgumentList "/d", "/s", "/c", $backendCommand -PassThru -WindowStyle Hidden
$backendProcess.Id | Set-Content $backendPidFile -Encoding ASCII

$healthUrl = "http://127.0.0.1:$env:BACKEND_PORT/api/health"
$backendReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $backendReady = $true; break }
    } catch { }
}
if (-not $backendReady) {
    & taskkill.exe /PID $backendProcess.Id /T /F | Out-Null
    Remove-Item $backendPidFile -Force -ErrorAction SilentlyContinue
    throw "Backend health check failed. Review logs\backend.log."
}

$env:BACKEND_INTERNAL_URL = "http://127.0.0.1:$env:BACKEND_PORT"
$frontendCommand = "cd /d `"$frontendDir`" && npm.cmd run start -- -H $env:FRONTEND_HOST -p $env:FRONTEND_PORT >> `"$frontendLog`" 2>&1"
$frontendProcess = Start-Process cmd.exe -ArgumentList "/d", "/s", "/c", $frontendCommand -PassThru -WindowStyle Hidden
$frontendProcess.Id | Set-Content $frontendPidFile -Encoding ASCII

$frontendReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$env:FRONTEND_PORT" -TimeoutSec 3
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { $frontendReady = $true; break }
    } catch { }
}
if (-not $frontendReady) {
    & taskkill.exe /PID $frontendProcess.Id /T /F | Out-Null
    & taskkill.exe /PID $backendProcess.Id /T /F | Out-Null
    Remove-Item $frontendPidFile, $backendPidFile -Force -ErrorAction SilentlyContinue
    throw "Frontend startup check failed. Review logs\frontend.log."
}

Write-Host "RWE-1 intranet services are running."
Show-IntranetAddresses
Write-Host "Logs: $script:Logs"
