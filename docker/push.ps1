# docker/push.ps1 — build images and push to Docker Hub (aipoclab).
#
# Usage (from ANY directory):
#   .\docker\push.ps1            # pushes :latest
#   .\docker\push.ps1 1.0.0      # pushes :1.0.0 AND :latest
#
# Prerequisites:
#   docker login -u aipoclab   (once — stores credentials in Windows Credential Manager)

param(
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"
$HubOrg        = "aipoclab"
$BackendImage  = "$HubOrg/gd-depth-backend"
$FrontendImage = "$HubOrg/gd-depth-frontend"

Push-Location $PSScriptRoot
try {
    # ── 1. Build ──────────────────────────────────────────────────────────────
    Write-Host "==> Building images..." -ForegroundColor Cyan
    docker compose build
    if ($LASTEXITCODE -ne 0) { throw "docker compose build failed" }

    # ── 2. Tag with Hub org prefix ────────────────────────────────────────────
    docker tag gd-depth-backend:latest  "${BackendImage}:latest"
    docker tag gd-depth-frontend:latest "${FrontendImage}:latest"

    if ($Tag -ne "latest") {
        Write-Host "==> Tagging :${Tag}..." -ForegroundColor Cyan
        docker tag gd-depth-backend:latest  "${BackendImage}:${Tag}"
        docker tag gd-depth-frontend:latest "${FrontendImage}:${Tag}"
    }

    # ── 3. Push ───────────────────────────────────────────────────────────────
    Write-Host "==> Pushing to Docker Hub..." -ForegroundColor Cyan
    docker push "${BackendImage}:latest"
    docker push "${FrontendImage}:latest"
    if ($Tag -ne "latest") {
        docker push "${BackendImage}:${Tag}"
        docker push "${FrontendImage}:${Tag}"
    }

} finally {
    Pop-Location
}

Write-Host ""
Write-Host "==> Done." -ForegroundColor Green
Write-Host "    ${BackendImage}:latest"
Write-Host "    ${FrontendImage}:latest"
Write-Host ""
Write-Host "On the Linux server:"
Write-Host "  docker compose pull && docker compose up -d"
