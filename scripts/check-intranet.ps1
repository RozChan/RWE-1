. (Join-Path $PSScriptRoot "intranet-common.ps1")
Import-IntranetEnvironment
New-Item -ItemType Directory -Force -Path $script:Logs | Out-Null

$frontendListening = Test-ListeningPort ([int]$env:FRONTEND_PORT)
$backendListening = Test-ListeningPort ([int]$env:BACKEND_PORT)
Write-Host "Frontend port $env:FRONTEND_PORT listening: $frontendListening"
Write-Host "Backend port $env:BACKEND_PORT listening: $backendListening"

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$env:BACKEND_PORT/api/health" -TimeoutSec 3
    Write-Host "Backend health: $($health.status)"
} catch { Write-Warning "Backend health check failed: $($_.Exception.Message)" }

try {
    $home = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$env:FRONTEND_PORT" -TimeoutSec 5
    Write-Host "Local home page HTTP status: $($home.StatusCode)"
} catch { Write-Warning "Local home page check failed: $($_.Exception.Message)" }

Show-IntranetAddresses
Write-Host "Backend log: $(Join-Path $script:Logs 'backend.log')"
Write-Host "Frontend log: $(Join-Path $script:Logs 'frontend.log')"
