# GD Depth — Deployment Guide

## Prerequisites

- Docker Desktop installed and running on the dev machine
- Logged in to Docker Hub: `docker login -u aipoclab`
- SSH access to the Linux server: `grigoriev_adm@ML-Prod`
- SSL certificates already present on the server at `/etc/ssl/gd-depth/fullchain.pem` and `/etc/ssl/gd-depth/privkey.pem`

---

## Dev machine (Windows)

### 1. Build and push Docker images

```powershell
.\docker\push.ps1
```

This builds both backend and frontend images and pushes them to Docker Hub as:
- `aipoclab/gd-depth-backend:latest`
- `aipoclab/gd-depth-frontend:latest`

To also tag a versioned release:
```powershell
.\docker\push.ps1 1.0.0
```

### 2. Copy deployment files to the server

```powershell
scp docker/docker-compose.release.yml "grigoriev_adm@ML-Prod:~/AI/production/gd-deph/docker-compose.yml"
scp docker/.env                        "grigoriev_adm@ML-Prod:~/AI/production/gd-deph/.env"
scp docker/install.sh                  "grigoriev_adm@ML-Prod:~/AI/production/gd-deph/install.sh"
scp docker/data/backend.env            "grigoriev_adm@ML-Prod:~/AI/production/gd-deph/data/backend.env"
```

> Only needed on first deploy or when configuration changes. Docker images are pulled from Hub automatically.

---

## Linux server (ML-Prod — 172.31.14.92)

### First-time install

```bash
ssh grigoriev_adm@ML-Prod
cd ~/AI/production/gd-deph
chmod +x install.sh
bash install.sh
```

The script will:
1. Install Docker Engine if not present
2. Check SSL certificates at `/etc/ssl/gd-depth/`
3. Create `data/uploads/` and `data/users.db`
4. Pull images from Docker Hub
5. Start the stack

App is available at:
- **HTTPS** → `https://172.31.14.92:5238`
- **HTTP** → `http://172.31.14.92:5239` (redirects to HTTPS)

### Update (after a new push)

```bash
cd ~/AI/production/gd-deph
docker compose pull && docker compose up -d
```

### Useful commands

```bash
# Stack status
docker compose ps

# Live logs
docker compose logs -f

# Backend logs only
docker compose logs -f backend

# Stop
docker compose down

# Restart backend only
docker compose restart backend
```

---

## Configuration files

| File | Purpose |
|---|---|
| `docker/.env` | Compose-level settings (HTTP_PORT=5239, HTTPS_PORT=5238) |
| `docker/data/backend.env` | Application secrets (AWS, LDAP, SMTP, OAuth, MCP) |
| `docker/docker-compose.release.yml` | Production compose file (uses Hub images) |
| `docker/docker-compose.yml` | Dev/build compose file (builds locally) |

### Ports

| Port | Protocol | Role |
|---|---|---|
| 5238 | HTTPS | Main app (nginx → backend) |
| 5239 | HTTP | Redirects to HTTPS |
| 3001 | HTTP | Backend only (internal, not exposed) |

---

## MCP servers (Claude Code)

Both MCP servers are configured globally in `D:\Users\GRIGORIEV\.claude\mcp.json`:

| Server | URL | Token |
|---|---|---|
| `gd-depth` | `https://172.31.14.92:5239` | `gd-depth-mcp-horiba-2026` |
| `astra-docs` | `https://172.31.14.92:5234` | `astra-mcp-horiba-2026` |

Tools available: `search_docs`, `list_documents`, `get_kb_stats`.
