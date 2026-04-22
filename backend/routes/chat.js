/**
 * routes/chat.js — proxies chat completion to Amazon Bedrock Claude.
 *
 * POST /api/chat
 * Body: { message: string, history: {role, text}[], lang?: string }
 * Response: { text: string, images: string[] }
 *
 * The frontend sends messages here instead of calling Gemini directly.
 * This keeps AWS credentials server-side and allows the KB search to happen
 * in the same process without CORS issues.
 */

import express from "express";
import { requireAuth } from "../shared.js";
import { searchKnowledgeBase, translateChunks } from "../retrieval/query_pipeline.js";
import { callClaude } from "../ingestion/embedder.js";
import { logger } from "../utils/logger.js";

export const router = express.Router();

router.post("/api/chat", requireAuth, express.json(), async (req, res) => {
  const { message, history = [], lang = "en" } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  try {
    // 1. Retrieve KB context
    const results    = await searchKnowledgeBase(message);
    const translated = await translateChunks(results, lang);

    const chunkFiles  = translated.map(c => c.filename ?? null);
    const chunkImages = translated.map(c => c.images   ?? []);

    // Collect images from top-2 unique source files
    const seenFiles = new Set();
    const topFiles  = [];
    for (const f of chunkFiles) {
      if (f && !seenFiles.has(f)) { seenFiles.add(f); topFiles.push(f); }
      if (topFiles.length === 2) break;
    }
    const images = [...new Set(
      chunkFiles.flatMap((f, i) => topFiles.includes(f ?? "") ? (chunkImages[i] ?? []) : [])
    )];

    // 2. Build system prompt
    let system = "You are a smart documentation assistant. Be concise and helpful. Format your answers using markdown (use **bold**, bullet lists, etc.) when appropriate.\n";

    if (translated.length) {
      const context = translated.map((c, i) => {
        const label = chunkFiles[i];
        return label ? `[${label}]\n${c.text}` : c.text;
      }).join("\n---\n");

      system += `\nKnowledge base context (use this as primary source):\n${context}\n`;
      system += "Each passage is labeled with its source filename in brackets. When citing, reference the document by its filename exactly as shown. ";
      if (images.length) system += "Relevant diagrams are displayed automatically to the user. Do not say there are no images. ";
      system += "If the answer is in the knowledge base, base your answer strictly on it. If not found, say so clearly.\n";
    }

    // 3. Build conversation string
    const conv = [...history, { role: "user", text: message }]
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");

    const prompt = system + conv + "\nAssistant:";

    // 4. Call Claude
    const text = await callClaude(prompt, { maxTokens: 2000 });

    logger.info("Chat completion", { chunksUsed: translated.length, imagesAttached: images.length });
    res.json({ text, images });
  } catch (err) {
    logger.error("Chat error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
