#!/usr/bin/env bash
# install.sh — first-time setup on the Linux target server.
# Run from inside the deployment package directory (where docker-compose.yml lives).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

green()  { echo -e "\033[0;32m$*\033[0m"; }
yellow() { echo -e "\033[1;33m$*\033[0m"; }
red()    { echo -e "\033[0;31m$*\033[0m"; }
ask()    { read -rp "$(yellow "$1")" "$2"; }

# ── 1. Docker ──────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  green "==> Installing Docker Engine..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  green "    Docker installed. Log out and back in, then re-run this script."
  exit 0
else
  green "==> Docker already installed: $(docker --version)"
fi

if ! docker compose version &>/dev/null 2>&1; then
  green "==> Installing Docker Compose plugin..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get remove -y docker-buildx 2>/dev/null || true
    sudo apt-get install -y docker-compose-plugin
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y docker-compose-plugin
  else
    red "ERROR: Cannot install Docker Compose automatically. Install it manually."
    exit 1
  fi
fi

# ── 2. SSL certificates ────────────────────────────────────────────────────────
if [[ ! -f /etc/ssl/gd-depth/fullchain.pem ]]; then
  yellow ""
  yellow "==> SSL certificates not found at /etc/ssl/gd-depth/"
  yellow "    Copy your fullchain.pem and privkey.pem there:"
  yellow "      sudo mkdir -p /etc/ssl/gd-depth"
  yellow "      sudo cp fullchain.pem privkey.pem /etc/ssl/gd-depth/"
  yellow "    Then re-run this script."
  yellow ""
  ask "    Press Enter to continue anyway (HTTP redirect to HTTPS will fail)..." _
fi

# ── 3. Prepare data directory ──────────────────────────────────────────────────
green "==> Creating data directories..."
mkdir -p data/uploads
[[ ! -f data/users.db ]] && touch data/users.db

# ── 4. Configure .env ─────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  yellow "==> .env created with HTTP_PORT=5238 HTTPS_PORT=5237 — edit if needed."
fi

# ── 5. Configure backend.env ──────────────────────────────────────────────────
if [[ ! -f data/backend.env ]]; then
  cp data/backend.env.example data/backend.env
  yellow ""
  yellow "==> ACTION REQUIRED: edit data/backend.env"
  yellow "    Verify FRONTEND_URL, FRONTEND_ORIGIN, APP_BASE_URL, GOOGLE_REDIRECT_URI"
  yellow ""
  ask "    Press Enter to open in nano..." _
  nano data/backend.env
fi

# ── 6. Pull images and start ───────────────────────────────────────────────────
green "==> Pulling images from Docker Hub..."
docker compose pull

green "==> Starting GD Depth..."
docker compose up -d

echo ""
green "==> Done."
echo ""
echo "  Stack status : docker compose ps"
echo "  Logs         : docker compose logs -f"
echo "  Stop         : docker compose down"
echo ""
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "172.31.14.92")
echo "  Open: https://${HOST_IP}:5237"
echo ""
