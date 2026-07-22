$ErrorActionPreference = "Stop"

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script:Logs = Join-Path $script:Root "logs"

function Import-IntranetEnvironment {
    $defaults = @{
        BACKEND_INTERNAL_URL = "http://127.0.0.1:8000"
        FRONTEND_HOST = "0.0.0.0"
        FRONTEND_PORT = "3000"
        BACKEND_HOST = "127.0.0.1"
        BACKEND_PORT = "8000"
    }
    foreach ($entry in $defaults.GetEnumerator()) {
        if (-not [Environment]::GetEnvironmentVariable($entry.Key, "Process")) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
        }
    }

    $envFile = Join-Path $script:Root ".env.intranet"
    if (Test-Path $envFile) {
        foreach ($rawLine in Get-Content $envFile -Encoding UTF8) {
            $line = $rawLine.Trim()
            if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
            $parts = $line.Split("=", 2)
            $name = $parts[0].Trim()
            $value = $parts[1].Trim().Trim('"').Trim("'")
            if ($name) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
        }
    }
}

function Get-IntranetIPv4Addresses {
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -ne "127.0.0.1" -and
            $_.AddressState -eq "Preferred" -and
            $_.PrefixOrigin -ne "WellKnown"
        } |
        Select-Object -ExpandProperty IPAddress -Unique
}

function Test-ListeningPort([int]$Port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Test-ProjectPid([string]$PidFile) {
    if (-not (Test-Path $PidFile)) { return $false }
    $savedPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $savedPid) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue; return $false }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    if (-not $process -or $process.CommandLine -notlike "*$script:Root*") {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        return $false
    }
    return $true
}

function Show-IntranetAddresses {
    Write-Host "Local:    http://localhost:$env:FRONTEND_PORT"
    $addresses = @(Get-IntranetIPv4Addresses)
    if (-not $addresses.Count) {
        Write-Warning "No usable intranet IPv4 address was detected. Run ipconfig and check the network connection."
        return
    }
    foreach ($address in $addresses) {
        if ($address.StartsWith("169.254.")) {
            Write-Warning "http://$address`:$env:FRONTEND_PORT uses a 169.254.x.x link-local address; this is usually not a normal company intranet address."
        } else {
            Write-Host "Intranet: http://$address`:$env:FRONTEND_PORT"
        }
    }
}
