/**
 * routes/knowledgeBase.js — Knowledge base REST endpoints
 *
 * Wired directly to the new module structure:
 *   ingestion/pipeline.js  — ingestDocument
 *   retrieval/query_pipeline.js — searchKnowledgeBase, translateChunks
 *   graph/driver.js        — cypher (reset)
 *   graph/queries/document.js — listDocuments, deleteDocument
 *   ingestion/image_resolver.js — KB_IMAGES_DIR
 *   utils/config.js        — SUPPORTED_EXTS, IMAGE_EXTS
 *   utils/logger.js        — logger
 */

import express from "express";
import multer from "multer";
import JSZip from "jszip";
import crypto from "crypto";
import { requireAuth, requireAdmin, requireContributor } from "../shared.js";
import { ingestDocument } from "../ingestion/pipeline.js";
import { searchKnowledgeBase, translateChunks } from "../retrieval/query_pipeline.js";
import { listDocuments, deleteDocument, resetDocuments, findDocumentIdsByFilepath, getDocumentImagesByFilename } from "../graph/queries/document.js";
import { SUPPORTED_EXTS, IMAGE_EXTS } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Deletes all KBDocument nodes (and their chunks + disk images) that have the
 * given filepath.  Called before batch re-ingest to prevent stale duplicates.
 *
 * @param {string} filepath
 */
async function purgeByFilepath(filepath) {
  const ids = findDocumentIdsByFilepath(filepath);
  for (const id of ids) {
    await deleteDocument(id);
  }
}

const kbUpload      = multer({ storage: multer.memoryStorage(), limits: { fileSize:  50 * 1024 * 1024 } });
const kbBatchUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ── SSE job store ──────────────────────────────────────────────────────────────
// jobId -> { res: ServerResponse | null, queue: string[], done: boolean }
const _jobs = new Map();

function _sseEmit(jobId, event, data) {
  const job = _jobs.get(jobId);
  if (!job) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (job.res) job.res.write(msg);
  else         job.queue.push(msg);
}

function _sseFinish(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return;
  job.done = true;
  const msg = `event: done\ndata: {}\n\n`;
  if (job.res) { job.res.write(msg); job.res.end(); }
  else         job.queue.push(msg);
  // Keep job available for 10 min so the frontend can reconnect and receive the done event
  setTimeout(() => _jobs.delete(jobId), 10 * 60_000);
}

// ── Single file upload (PDF / Markdown / DOCX) ────────────────────────────────

router.post("/api/knowledge-base/upload", requireAuth, requireContributor, kbUpload.any(), async (req, res) => {
  const file = req.files?.[0];
  if (!file) return res.status(400).json({ error: "File required (pdf, md, docx)" });
  try {
    const filename     = Buffer.from(file.originalname, "latin1").toString("utf8");
    const documentDate = req.body.documentDate?.trim() || null;
    const result = await ingestDocument({ buffer: file.buffer, filename, uploadedBy: req.session.user.id, documentDate });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error("KB", "Single upload error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Batch upload — starts SSE job, returns jobId immediately ──────────────────

router.post("/api/knowledge-base/upload-batch", requireAuth, requireContributor, kbBatchUpload.array("files", 100), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "No files provided" });

  const jobId  = crypto.randomUUID();
  const userId = req.session.user.id;
  _jobs.set(jobId, { res: null, queue: [], done: false });
  res.json({ jobId });

  (async () => {
    for (const f of req.files) {
      const filename = Buffer.from(f.originalname, "latin1").toString("utf8");
      const ext      = filename.toLowerCase().split(".").pop();

      if (ext === "zip") {
        let zip;
        try { zip = await JSZip.loadAsync(f.buffer); }
        catch (e) { _sseEmit(jobId, "file_error", { filename, error: `ZIP read failed: ${e.message}` }); continue; }

        const entries = Object.entries(zip.files).filter(([, e]) => !e.dir);

        // Pre-collect all image files from ZIP
        const zipImages = new Map();
        for (const [zipPath, zipEntry] of entries) {
          const imgExt = zipPath.toLowerCase().split(".").pop();
          if (IMAGE_EXTS.has(imgExt)) {
            zipImages.set(zipPath, await zipEntry.async("nodebuffer"));
          }
        }

        for (const [zipPath, zipEntry] of entries) {
          const innerExt = zipPath.toLowerCase().split(".").pop();
          if (!SUPPORTED_EXTS.includes(innerExt)) continue;
          const basename  = zipPath.split("/").pop();
          const zipDir    = zipPath.split("/").slice(0, -1).join("/");
          const entryDate = zipEntry.date ? zipEntry.date.toISOString().slice(0, 10) : null;
          _sseEmit(jobId, "processing", { filename: basename });
          try {
            await purgeByFilepath(zipPath);
            const buf = await zipEntry.async("nodebuffer");
            const r   = await ingestDocument({ buffer: buf, filename: basename, uploadedBy: userId, documentDate: entryDate, zipImages, zipDir, filepath: zipPath });
            _sseEmit(jobId, "file_done", { filename: basename, chunkCount: r.chunkCount });
          } catch (e) {
            _sseEmit(jobId, "file_error", { filename: basename, error: e.message });
          }
        }

      } else if (SUPPORTED_EXTS.includes(ext)) {
        _sseEmit(jobId, "processing", { filename });
        try {
          await purgeByFilepath(filename);
          const r = await ingestDocument({ buffer: f.buffer, filename, uploadedBy: userId, documentDate: null });
          _sseEmit(jobId, "file_done", { filename, chunkCount: r.chunkCount });
        } catch (e) {
          _sseEmit(jobId, "file_error", { filename, error: e.message });
        }
      } else {
        _sseEmit(jobId, "file_error", { filename, error: `Unsupported format: .${ext}` });
      }
    }
    _sseFinish(jobId);
  })();
});

// ── SSE progress stream ────────────────────────────────────────────────────────

router.get("/api/knowledge-base/batch-progress/:jobId", requireAuth, requireContributor, (req, res) => {
  const job = _jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  job.res = res;
  for (const msg of job.queue) res.write(msg);
  job.queue = [];

  if (job.done) { res.write(`event: done\ndata: {}\n\n`); res.end(); return; }

  // Heartbeat every 15 s — prevents nginx proxy_read_timeout from closing idle connections
  // (critical for large ZIPs where individual files take a long time to enrich/embed)
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    if (_jobs.has(req.params.jobId)) _jobs.get(req.params.jobId).res = null;
  });
});

// ── List documents ─────────────────────────────────────────────────────────────

router.get("/api/knowledge-base/documents", requireAuth, async (_req, res) => {
  try { res.json(await listDocuments()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete document ────────────────────────────────────────────────────────────

router.delete("/api/knowledge-base/documents/:id", requireAuth, requireContributor, async (req, res) => {
  try {
    await deleteDocument(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Document images ────────────────────────────────────────────────────────────

router.get("/api/knowledge-base/documents/:id/images", requireAuth, async (req, res) => {
  try {
    const docs = await listDocuments();
    const doc  = docs.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const images = await getDocumentImagesByFilename(doc.filename);
    res.json({ images });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update document (replace with new version) ─────────────────────────────────

router.post("/api/knowledge-base/documents/:id/update", requireAuth, requireContributor, kbUpload.any(), async (req, res) => {
  const file = req.files?.[0];
  if (!file) return res.status(400).json({ error: "File required" });

  try {
    const docs     = listDocuments();
    const existing = docs.find(d => d.id === req.params.id);
    if (!existing) return res.status(404).json({ error: "Document not found" });

    const filename     = Buffer.from(file.originalname, "latin1").toString("utf8");
    const documentDate = req.body.documentDate?.trim() || null;

    await deleteDocument(req.params.id);

    const result = await ingestDocument({
      buffer: file.buffer,
      filename,
      uploadedBy: req.session.user.id,
      documentDate,
      filepath: existing.filepath,
    });

    logger.info("KB document updated", { oldId: req.params.id, newId: result.docId, filename });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error("KB document update error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Reset knowledge base ───────────────────────────────────────────────────────

router.delete("/api/knowledge-base/reset", requireAuth, requireAdmin, async (_req, res) => {
  try {
    await resetDocuments();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Search ─────────────────────────────────────────────────────────────────────

router.post("/api/knowledge-base/search", requireAuth, express.json(), async (req, res) => {
  const { query, lang } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  try {
    const results     = await searchKnowledgeBase(query);
    logger.info('KB search', { query, chunksFound: results.length });
    const translated  = await translateChunks(results, lang ?? "fr");
    const chunks      = translated.map(c => c.text);
    const chunkFiles  = translated.map(c => c.filename ?? null);
    const chunkImages = translated.map(c => c.images ?? []);
    const seen        = new Map();
    for (const c of translated) {
      if (c.filename && !seen.has(c.filename)) seen.set(c.filename, c.documentDate ?? null);
    }
    const sources = [...seen.entries()].map(([filename, documentDate]) => ({ filename, documentDate }));
    res.json({ chunks, chunkFiles, chunkImages, sources });
  } catch (e) {
    logger.error("KB", "Search error:", e.message);
    res.json({ chunks: [] });
  }
});
