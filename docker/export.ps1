# docker/export.ps1 — build images and create a self-contained deployment package.
#                     For servers with no internet access (no Docker Hub needed).
#
# Usage (from ANY directory):
#   .\docker\export.ps1
#
# Requirements: Docker Desktop, tar.exe (built into Windows 10+)

$ErrorActionPreference = "Stop"
$Date    = Get-Date -Format "yyyyMMdd"
$Package = "gd-depth-deploy-$Date"
$Dist    = Join-Path $PSScriptRoot $Package

Push-Location $PSScriptRoot
try {
    # ── 1. Build ──────────────────────────────────────────────────────────────
    Write-Host "==> Building images..." -ForegroundColor Cyan
    docker compose build
    if ($LASTEXITCODE -ne 0) { throw "docker compose build failed" }

    # ── 2. Save images ────────────────────────────────────────────────────────
    Write-Host "==> Saving images (this may take a while)..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path "$Dist\images" | Out-Null

    docker save gd-depth-backend:latest  -o "$Dist\images\gd-depth-backend.tar"
    docker save gd-depth-frontend:latest -o "$Dist\images\gd-depth-frontend.tar"

    # ── 3. Copy deployment files ──────────────────────────────────────────────
    Write-Host "==> Assembling deploy package..." -ForegroundColor Cyan
    Copy-Item "$PSScriptRoot\docker-compose.release.yml" "$Dist\docker-compose.yml"
    Copy-Item "$PSScriptRoot\.env.example"               "$Dist\.env.example"
    New-Item -ItemType Directory -Force -Path "$Dist\data" | Out-Null
    Copy-Item "$PSScriptRoot\data\backend.env"           "$Dist\data\backend.env.example"
    Copy-Item "$PSScriptRoot\install.sh"                 "$Dist\install.sh"

    # ── 4. Create archive ─────────────────────────────────────────────────────
    Write-Host "==> Creating archive..." -ForegroundColor Cyan
    $Archive = "$Package.tar.gz"
    & tar -czf $Archive $Package
    if ($LASTEXITCODE -ne 0) { throw "tar failed — requires Windows 10 build 17063 or later" }

    Remove-Item -Recurse -Force $Dist

} finally {
    Pop-Location
}

Write-Host ""
Write-Host "==> Done: docker\$Package.tar.gz" -ForegroundColor Green
Write-Host ""
Write-Host "Transfer to the Linux server:"
Write-Host "  scp docker\$Package.tar.gz user@172.31.14.92:~/"
Write-Host "  ssh user@172.31.14.92"
Write-Host "  tar -xzf $Package.tar.gz && cd $Package && bash install.sh"
