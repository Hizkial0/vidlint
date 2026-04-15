param(
    [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$backendPort = 8787
$healthUrl = "http://localhost:$backendPort/health"

if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $CommitMessage = "Deploy " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

Write-Host "============================================"
Write-Host "  VidLint Deploy"
Write-Host "============================================"
Write-Host "Repo: $repoRoot"
Write-Host "Commit: $CommitMessage"
Write-Host ""

Push-Location $repoRoot
try {
    git add -A
    if ($LASTEXITCODE -ne 0) {
        throw "git add failed."
    }

    $statusOutput = git status --porcelain
    if ($LASTEXITCODE -ne 0) {
        throw "git status failed."
    }

    if ($statusOutput) {
        git commit -m $CommitMessage
        if ($LASTEXITCODE -ne 0) {
            throw "git commit failed."
        }
    } else {
        Write-Host "No local changes to commit. Continuing with push + restart..."
    }

    git push origin main
    if ($LASTEXITCODE -ne 0) {
        throw "git push failed."
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Restarting backend on port $backendPort..."
$listeners = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        Write-Host "Stopping process $_"
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
}

Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $backendDir -WindowStyle Hidden
Start-Sleep -Seconds 6

$health = Invoke-WebRequest -UseBasicParsing $healthUrl | Select-Object -ExpandProperty Content

Write-Host ""
Write-Host "Deploy complete."
Write-Host "Health: $health"
Write-Host ""
Read-Host "Press Enter to close"
