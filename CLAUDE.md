# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

**Backend** (Node.js 20, ESM):
```
cd backend && node server.js
# or: .\start.bat
```
Port 3001. If `EADDRINUSE`, kill the stale process: `netstat -ano | grep :3001`, then `taskkill /PID <pid> /F`.

**Frontend** (React + Vite):
```
cd frontend && npm run dev    # dev server on :5173 with proxy to :3001
cd frontend && npm run build  # production build to frontend/dist
cd frontend && npm run lint   # eslint
```

Both must run simultaneously in development. The Vite dev server proxies `/api`, `/auth`, and `/uploads` to the backend.

No test suite exists. There is no `npm test` command.

## Architecture overview

This is a RAG (Retrieval-Augmented Generation) chat application backed by **Amazon Bedrock Knowledge Base**.

### AWS data flow

**Ingestion** (`POST /api/knowledge-base/upload`):
1. Extract text from PDF / Markdown / DOCX (`ingestion/extractor.js`)
2. Extract and upload images to S3 images bucket; replace `[IMAGE_REF:...]` tokens with `[img:{key}]` tokens (`ingestion/image_resolver.js`)
3. Chunk text by markdown headers / paragraphs, 500-word max (`ingestion/chunker.js`)
4. For each chunk: Claude rewrites it as a self-contained paragraph and extracts entities/relations (`ingestion/enricher.js`)
5. Assemble enriched markdown (with `[img:key]` tokens) and upload to `S3_BUCKET` under key `{S3_DOC_PREFIX}/{docId}/{basename}.md`
6. Trigger Bedrock KB ingestion sync (`aws/bedrock.js → syncKnowledgeBase()`)
7. Save document metadata (s3Key, image keys, summary, language) to SQLite `documents` table

**Retrieval** (`POST /api/chat` or `POST /api/knowledge-base/search`):
1. Call Bedrock KB `retrieve()` API (`aws/bedrock.js → retrieveFromKB()`)
2. Parse `[img:{key}]` tokens from returned chunk text → convert to public S3 URLs
3. Look up document filename / documentDate from SQLite by docId (extracted from S3 source URI)
4. Optionally translate chunks via Claude (`retrieval/translator.js`)
5. Claude generates a response with KB context injected as system prompt (`routes/chat.js`)

### Key files

| File | Role |
|---|---|
| `backend/server.js` | Entry point — mounts all routers, calls `initKnowledgeBase()` |
| `backend/shared.js` | SQLite DB init, session store, auth middleware (`requireAuth`, `requireAdmin`, `requireContributor`) |
| `backend/utils/config.js` | Single source for all env vars — throws at startup if required vars missing |
| `backend/kb.js` | Re-export facade — `initKnowledgeBase`, `ingestDocument`, `searchKnowledgeBase`, etc. |
| `backend/aws/bedrock.js` | `retrieveFromKB()`, `syncKnowledgeBase()`, `getIngestionJobStatus()` |
| `backend/aws/s3.js` | `uploadDocument()`, `deleteDocument()`, `uploadImage()`, `deleteImage()`, `imagePublicUrl()` |
| `backend/ingestion/pipeline.js` | Orchestrates full ingestion for one document |
| `backend/ingestion/enricher.js` | Claude entity extraction + chunk rewrite (`callGemini` = `callClaude` alias) |
| `backend/retrieval/query_pipeline.js` | `searchKnowledgeBase()` — Bedrock retrieve + image token parsing + SQLite metadata lookup |
| `backend/graph/queries/document.js` | SQLite CRUD: `upsertDocument`, `listDocuments`, `deleteDocument`, `resetDocuments` |
| `backend/routes/chat.js` | `POST /api/chat` — retrieval + Claude response |
| `backend/routes/knowledgeBase.js` | Upload, batch upload (SSE), list, delete, reset endpoints |
| `frontend/src/services/gemini.ts` | `sendToGemini()` calls `POST /api/chat` (no Gemini dependency — name is legacy) |

### Storage

- **SQLite** (`users.db`): users, sessions, projects, chats, messages, **documents** table
- **S3 `kb-ds-ai4gd`** (`S3_BUCKET`): enriched markdown files at `{S3_DOC_PREFIX}/{docId}/{basename}.md`
- **S3 `aisav-chat-images`** (`S3_IMAGES_BUCKET`): extracted images at `{docId}/{zipRelPath}` — must be **public-read**
- **Bedrock KB** (`BD7PNUTAKG`): managed vector index, synced from `S3_BUCKET` after each upload

### Auth

Session-cookie auth (`gd_session`). Three roles: `admin`, `contributor`, `user`. Routes use `requireAuth` / `requireContributor` / `requireAdmin` from `shared.js`. Google OAuth and LDAP are optional — controlled by env vars (`GOOGLE_OAUTH_ENABLED`, LDAP env vars). An admin seed account is created at startup from `ADMIN_SEED_EMAIL`.

### MCP server

`backend/mcp-server.js` is a standalone stdio MCP server that connects to a running backend via HTTP using `X-MCP-Token`. Run it separately; it exposes `search_docs`, `list_documents`, `get_kb_stats` tools to Claude Code.

### Frontend

React 19 + TypeScript + Tailwind CSS v4. Single-page app in `src/App.tsx`. No router — all navigation is state-driven. Key components:
- `ChatPanel` — message thread, sends via `services/gemini.ts → POST /api/chat`
- `AddPdfDialog` — uploads documents, shows SSE batch progress
- `AuthDialog` — email login/register + Google OAuth
- `ValidationDialog` / `UsersDialog` — admin panels

### Image token protocol

During ingestion, `[IMAGE_REF:path]` tokens (from markdown image refs) become `[img:{s3Key}]` tokens embedded in the enriched text uploaded to S3. The Bedrock KB indexes these tokens as text. At retrieval time, `query_pipeline.js` parses them with `/\[img:([^\]]+)\]/g` and converts keys to public URLs via `imagePublicUrl()`.

### Python directory

`python/` is the original Streamlit prototype (AWS Bedrock + S3 direct calls, no graph). The real AWS resource IDs (`KB_ID`, `KB_DATA_SOURCE_ID`, S3 bucket names) live in `python/settings.json` and are the source of truth for configuring `backend/.env`.
