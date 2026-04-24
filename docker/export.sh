#!/usr/bin/env bash
# docker/export.sh — build images and create a self-contained deployment package
#                    (for servers with no internet access — no Docker Hub needed).
#
# Usage (run from the docker/ directory):
#   bash export.sh
#
# Output:
#   gd-depth-deploy-<date>.tar.gz   ready to transfer to the Linux server

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE=$(date +%Y%m%d)
PACKAGE="gd-depth-deploy-${DATE}"
DIST="${SCRIPT_DIR}/${PACKAGE}"

# ── 1. Build ───────────────────────────────────────────────────────────────────
echo "==> Building images (this may take several minutes on first run)..."
cd "${SCRIPT_DIR}"
docker compose build

# ── 2. Save images to tar files ────────────────────────────────────────────────
echo "==> Saving images..."
mkdir -p "${DIST}/images"
docker save gd-depth-backend:latest  | gzip > "${DIST}/images/gd-depth-backend.tar.gz"
docker save gd-depth-frontend:latest | gzip > "${DIST}/images/gd-depth-frontend.tar.gz"

# ── 3. Copy deployment files ───────────────────────────────────────────────────
echo "==> Assembling deploy package..."
cp "${SCRIPT_DIR}/docker-compose.release.yml" "${DIST}/docker-compose.yml"
cp "${SCRIPT_DIR}/.env.example"               "${DIST}/.env.example"
mkdir -p "${DIST}/data"
cp "${SCRIPT_DIR}/data/backend.env"           "${DIST}/data/backend.env.example"
cp "${SCRIPT_DIR}/install.sh"                 "${DIST}/install.sh"
chmod +x "${DIST}/install.sh"

# ── 4. Create the archive ──────────────────────────────────────────────────────
cd "${SCRIPT_DIR}"
tar -czf "${PACKAGE}.tar.gz" "${PACKAGE}"
rm -rf "${DIST}"

echo ""
echo "==> Done: docker/${PACKAGE}.tar.gz"
echo ""
echo "Transfer to the Linux server, then:"
echo "  scp docker/${PACKAGE}.tar.gz user@172.31.14.92:~/"
echo "  ssh user@172.31.14.92"
echo "  tar -xzf ${PACKAGE}.tar.gz && cd ${PACKAGE} && bash install.sh"
