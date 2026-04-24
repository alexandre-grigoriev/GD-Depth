#!/bin/bash
set -e

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"
DATA_DIR="$(dirname "$0")/data"

# ── 1. Ensure data directory and persistent files exist ───────────────────────
mkdir -p "$DATA_DIR/uploads"
touch "$DATA_DIR/users.db"

if [ ! -f "$DATA_DIR/backend.env" ]; then
  echo "ERROR: $DATA_DIR/backend.env not found."
  echo "Copy docker/data/backend.env to the server and fill in YOUR_SERVER_IP_OR_DOMAIN."
  exit 1
fi

# ── 2. Build images ───────────────────────────────────────────────────────────
echo "Building images..."
docker compose -f "$COMPOSE_FILE" build --no-cache

# ── 3. Restart containers ─────────────────────────────────────────────────────
echo "Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# ── 4. Show status ────────────────────────────────────────────────────────────
echo ""
docker compose -f "$COMPOSE_FILE" ps
echo ""
echo "Done. Follow logs with:"
echo "  docker compose -f $COMPOSE_FILE logs -f"
