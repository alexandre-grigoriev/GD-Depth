# GD Depth — AI Documentation Assistant

A RAG (Retrieval-Augmented Generation) chat application that lets users query a private knowledge base of technical documents using natural language. Documents are enriched with Claude before indexing, retrieved via Amazon Bedrock Knowledge Base, and answered by Claude with inline image support.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 + Vite |
| Backend | Node.js 20 (ESM) + Express |
| LLM / Enrichment | Amazon Bedrock — Claude 3.5 Sonnet |
| Knowledge Base | Amazon Bedrock Knowledge Base (managed vector search) |
| Document storage | Amazon S3 |
| User / chat data | SQLite (better-sqlite3) |

## Getting started

### Prerequisites

- Node.js 20+
- AWS credentials with access to Bedrock, S3, and the existing Knowledge Base
- A Bedrock Knowledge Base and S3 data-source bucket already provisioned (IDs in `python/settings.json`)

### Backend

```bash
cd backend
cp .env.example .env       # fill in KB_ID, S3_BUCKET, etc.
npm install
node server.js             # starts on :3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev                # starts on :5173, proxies /api to :3001
```

### Required `.env` variables

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

KB_ID=...                  # Bedrock Knowledge Base ID
KB_DATA_SOURCE_ID=...      # Bedrock data source ID
S3_BUCKET=...              # bucket for enriched markdown documents
S3_IMAGES_BUCKET=...       # bucket for extracted images (must be public-read)

ADMIN_SEED_EMAIL=...       # auto-created admin account on first run
SESSION_SECRET=...
```

## How it works

### Document ingestion

Upload a PDF, Markdown, or DOCX file via the UI (admin / contributor role required):

1. Text is extracted and images are identified
2. Images are uploaded to S3; their positions are marked with `[img:key]` tokens
3. Text is chunked by section (markdown headers → paragraphs → sliding window fallback)
4. Each chunk is rewritten by Claude as a self-contained paragraph with entity context
5. All enriched chunks are assembled into a single markdown file and uploaded to S3
6. A Bedrock KB ingestion sync is triggered — the KB re-indexes the S3 data source
7. Document metadata (filename, language, S3 key, image keys) is stored in SQLite

ZIP uploads are supported: all supported files inside the ZIP are ingested in one batch, with SSE progress streamed to the browser.

### Query / chat

1. User message is sent to `POST /api/chat`
2. Bedrock KB `retrieve()` returns the top-10 most semantically relevant chunks
3. `[img:key]` tokens in chunk text are resolved to public S3 URLs
4. Chunks are optionally translated to the user's selected language by Claude
5. Claude generates a response with KB chunks injected as system-prompt context
6. Response text and image URLs are returned to the frontend

## User roles

| Role | Permissions |
|---|---|
| `user` | Chat only |
| `contributor` | Chat + upload / delete documents |
| `admin` | All of the above + user management, KB reset |

First login creates an account in `pending` state. Admins approve accounts via the Users panel. The `ADMIN_SEED_EMAIL` account is auto-approved on startup.

Auth supports email + password (with email verification), Google OAuth, and LDAP — all optional except the email flow which is always active.

## MCP server

A stdio MCP server (`backend/mcp-server.js`) exposes the knowledge base to Claude Code:

```bash
# in Claude Code settings, add:
ASTRA_BASE_URL=http://localhost:3001
ASTRA_MCP_TOKEN=<value of MCP_SECRET in .env>
node backend/mcp-server.js
```

Tools: `search_docs`, `list_documents`, `get_kb_stats`.

## Project layout

```
backend/
  aws/            bedrock.js, s3.js — AWS client wrappers
  ingestion/      extractor, chunker, enricher, image_resolver, pipeline
  retrieval/      query_pipeline, translator
  graph/queries/  document.js — SQLite CRUD for document metadata
  routes/         auth, chat, knowledgeBase, conversations, users, mcp
  shared.js       SQLite init, session store, auth middleware
  utils/config.js centralised env-var access (throws on missing required vars)

frontend/
  src/
    components/   ChatPanel, AddPdfDialog, AuthDialog, admin panels
    services/     gemini.ts — sendToGemini() → POST /api/chat
    App.tsx       single-page shell, all navigation is state-driven

python/           original Streamlit prototype (reference only)
  settings.json   source of truth for AWS resource IDs
```
