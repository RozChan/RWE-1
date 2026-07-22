. (Join-Path $PSScriptRoot "intranet-common.ps1")
New-Item -ItemType Directory -Force -Path $script:Logs | Out-Null

$stopped = $false
foreach ($service in @("frontend", "backend")) {
    $pidFile = Join-Path $script:Logs "$service.pid"
    if (-not (Test-Path $pidFile)) {
        Write-Host "$service`: no PID file; nothing to stop."
        continue
    }
    $savedPid = Get-Content $pidFile | Select-Object -First 1
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -like "*$script:Root*") {
        & taskkill.exe /PID $savedPid /T /F | Out-Null
        Write-Host "$service`: stopped project process tree PID $savedPid."
        $stopped = $true
    } elseif ($process) {
        Write-Warning "$service`: PID $savedPid belongs to another command and was not stopped."
    } else {
        Write-Host "$service`: PID $savedPid was already stopped."
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
if (-not $stopped) { Write-Host "No running project services were found." }
