# GD Depth — Root Causes & Solved Issues

## Authentication

### LDAP configured but not wired
- **Symptom:** LDAP login unavailable
- **Cause:** `backend/.env` missing LDAP env vars
- **Fix:** Added `LDAP_ENABLED`, `LDAP_URL`, `LDAP_DOMAIN`, `LDAP_BASE_DN`, `LDAP_SEARCH_ATTR` from Astra Docs `.env`

### Google OAuth wrong redirect URI
- **Symptom:** OAuth callback fails
- **Cause:** `GOOGLE_REDIRECT_URI` pointed to wrong port after port change
- **Fix:** Updated to `https://172.31.14.92:5238/auth/google/callback`

---

## AWS / Bedrock

### Bedrock model EOL
- **Symptom:** `This model version has reached the end of its life`
- **Cause:** `BEDROCK_TEXT_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0` retired by AWS
- **Fix:** Updated to `global.anthropic.claude-opus-4-6-v1`

### Bedrock model requires inference profile
- **Symptom:** `Invocation of model ID ... with on-demand throughput isn't supported`
- **Cause:** Claude 3.7 Sonnet requires a cross-region inference profile
- **Fix:** Used `us.` prefix → then switched to `global.anthropic.claude-opus-4-6-v1`

### Bedrock model marked as Legacy
- **Symptom:** `Access denied. This Model is marked by provider as Legacy`
- **Cause:** Claude 3.7 Sonnet deprecated within 30 days of inactivity
- **Fix:** Switched to `global.anthropic.claude-opus-4-6-v1` (active Claude 4 model)

---

## Images

### Images not showing in chat (Python-ingested documents)
- **Symptom:** Chat responses showed no images despite knowledge base containing them
- **Cause:** Python pipeline embeds `[imageurl:filename.png]` tokens; Node.js retrieval only parsed `[img:key]` tokens
- **Fix:** Added `IMG_LEGACY_RE` regex in `retrieval/query_pipeline.js` to also parse `[imageurl:...]` tokens

### Images filtered out in chat response
- **Symptom:** Images extracted but never returned to frontend
- **Cause:** `chat.js` filtered images by `filename` (SQLite metadata), which was `null` for Python-ingested docs
- **Fix:** Removed filename filter; images now filtered by what Claude actually cites in its response

### Image URLs broken (spaces in filenames)
- **Symptom:** Broken image icons in chat; URLs contained literal spaces
- **Cause:** `imagePublicUrl()` didn't encode the S3 key
- **Fix:** Added `encodeURIComponent()` per path segment in `aws/s3.js`

### Image captions showing `%20`
- **Symptom:** Image captions displayed `GD%20training%20152%200` instead of `GD training 152 0`
- **Fix:** Added `decodeURIComponent()` when building title from URL in `ChatPanel.tsx`

### Small images upscaled to full width
- **Symptom:** Tiny images (e.g. DiP logo) stretched to fill message width
- **Cause:** `.msgImageFigure` had `width: 50%` forcing full stretch; flex column default `align-items: stretch`
- **Fix:** Changed to `width: fit-content; max-width: 50%` on figure; `max-width: 100%; width: auto` on image

### Too many / duplicate images shown
- **Symptom:** All images from all retrieved chunks shown, including duplicates
- **Cause:** `chat.js` collected all images from all chunks via `chunkImages.flat()`
- **Fix:** Backend now replaces `[filename.png]` citations with `![alt](url)` markdown inline; only cited images shown

---

## Deployment

### Docker build hanging for 12+ hours
- **Symptom:** `apt-get install build-essential python3` never completed
- **Cause:** Docker Desktop DNS misconfiguration blocking package downloads
- **Fix:** Added `"dns": ["8.8.8.8", "1.1.1.1"]` to Docker Engine config; switched deps stage base image from `node:22-bookworm-slim` to `node:22-bookworm` (pre-includes build tools)

### Port 5237 already in use on server
- **Symptom:** `listen tcp4 0.0.0.0:5237: bind: address already in use`
- **Cause:** Native nginx on ML-Prod already occupying ports 5236 and 5237; Astra Docs Docker on 5234/5235
- **Fix:** Changed GD Depth to HTTPS=5238, HTTP=5239 (confirmed free)

### SSL certificates missing in container
- **Symptom:** `cannot load certificate "/etc/ssl/gd-depth/fullchain.pem": No such file or directory`
- **Cause:** `/etc/ssl/gd-depth/` folder existed on server but was empty
- **Fix:** `sudo cp /etc/ssl/astra/* /etc/ssl/gd-depth/`

---

## MCP Server

### Wrong env var names in mcp-server.js
- **Symptom:** MCP server used `ASTRA_BASE_URL` / `ASTRA_MCP_TOKEN` (copied from Astra Docs)
- **Fix:** Renamed to `GD_DEPTH_BASE_URL` / `GD_DEPTH_MCP_TOKEN`

### Shared MCP token between projects
- **Symptom:** Both GD Depth and Astra Docs used `astra-mcp-horiba-2026`
- **Fix:** GD Depth token changed to `gd-depth-mcp-horiba-2026` in `backend/.env` and `.claude/settings.json`
