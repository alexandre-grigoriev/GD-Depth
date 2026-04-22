/**
 * mcp-server.js — Astra Docs MCP server (stdio transport, HTTP mode)
 *
 * Connects to a running Astra Docs backend (local or production) via HTTP.
 * No source code or Neo4j access required on the developer's machine.
 *
 * Configuration (environment variables):
 *   ASTRA_BASE_URL   — base URL of the Astra Docs backend (default: http://localhost:3001)
 *   ASTRA_MCP_TOKEN  — shared secret set as MCP_SECRET on the server
 *
 * Tools:
 *   search_docs       — RAG query, returns ranked chunks + source filenames
 *   list_documents    — all ingested documents with metadata
 *   get_kb_stats      — document / chunk / entity counts
 */
import { Server }               from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL  = (process.env.ASTRA_BASE_URL  || "http://localhost:3001").replace(/\/$/, "");
const MCP_TOKEN = process.env.ASTRA_MCP_TOKEN  || "";

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type":  "application/json",
      "X-MCP-Token":   MCP_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
    // Accept self-signed certs for on-prem deployments
    ...(BASE_URL.startsWith("https") ? { dispatcher: undefined } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// Node.js 18+ has native fetch but doesn't support rejectUnauthorized easily.
// For self-signed certs (e.g. https://172.31.14.92:5234) set NODE_TLS_REJECT_UNAUTHORIZED=0
// in the MCP server env (see .claude/settings.json).

// ── Server definition ─────────────────────────────────────────────────────────
const server = new Server(
  { name: "astra-docs", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool catalogue ────────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_docs",
      description:
        "Search the HORIBA Astra Docs knowledge base using semantic RAG retrieval. " +
        "Returns the most relevant documentation chunks with their source filenames.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The question or search query" },
          topK:  { type: "number", description: "Number of chunks to return (default 8, max 20)" },
        },
        required: ["query"],
      },
    },
    {
      name: "list_documents",
      description:
        "List all documents in the Astra Docs knowledge base with metadata " +
        "(filename, language, summary, upload date, word count, chunk count).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_kb_stats",
      description: "Return knowledge base statistics: document, chunk, and entity counts.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_docs") {
      const query = String(args?.query ?? "").trim();
      if (!query) throw new Error("query is required");
      const topK = Math.min(Math.max(1, Number(args?.topK ?? 8)), 20);

      const { chunks } = await api("POST", "/api/mcp/search", { query, topK });

      if (!chunks?.length) {
        return { content: [{ type: "text", text: "No relevant documentation found for this query." }] };
      }

      const formatted = chunks.map((c, i) => {
        const source = c.filename ?? "unknown";
        const date   = c.documentDate ? ` (${c.documentDate})` : "";
        return `### [${i + 1}] ${source}${date}\n${c.text.trim()}`;
      }).join("\n\n---\n\n");

      const sources = [...new Set(chunks.map(c => c.filename).filter(Boolean))];

      return {
        content: [{
          type: "text",
          text: `Found ${chunks.length} relevant chunks from ${sources.length} document(s).\n\n` +
                `**Sources:** ${sources.join(", ")}\n\n` + formatted,
        }],
      };
    }

    if (name === "list_documents") {
      const { documents } = await api("GET", "/api/mcp/documents");

      if (!documents?.length) {
        return { content: [{ type: "text", text: "The knowledge base is empty." }] };
      }

      const rows = documents.map(d => {
        const date = d.documentDate ?? d.uploadedAt?.slice(0, 10) ?? "—";
        return `- **${d.filename}** (${d.lang ?? "en"}) — ${d.chunkCount} chunks, ${d.wordCount ?? "?"} words, ${date}\n  ${d.summary ?? ""}`;
      }).join("\n");

      return {
        content: [{ type: "text", text: `**${documents.length} documents in knowledge base:**\n\n${rows}` }],
      };
    }

    if (name === "get_kb_stats") {
      const stats = await api("GET", "/api/mcp/stats");
      return {
        content: [{
          type: "text",
          text: `**Knowledge base stats:**\n- Documents: ${stats.documents}\n- Chunks: ${stats.chunks}\n- Entities: ${stats.entities}`,
        }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
