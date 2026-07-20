/**
 * routes/chat.js — proxies chat completion to Amazon Bedrock Claude.
 *
 * POST /api/chat
 * Body: { message: string, history: {role, text}[], lang?: string }
 * Response: { text: string, images: string[] }
 *
 * The frontend sends messages here instead of calling front model directly.
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

    // Build filename → URL map for post-response filtering
    const imageUrlByFilename = new Map();
    for (const urls of chunkImages) {
      for (const url of urls) {
        const filename = decodeURIComponent(url.split('/').pop() ?? '');
        if (filename) imageUrlByFilename.set(filename, url);
      }
    }

    // 2. Build system prompt
    let system = "You are a smart documentation assistant. Be concise and helpful. Format your answers using markdown: use ## for section titles, ### for subsections, **bold**, bullet lists, etc. Always use markdown headers for section titles — never leave them as plain unformatted text. When referencing an image, place its reference on its own line, not in the middle of a sentence (e.g. write the sentence ending with a colon, then the image reference on the next line).\n";

    if (translated.length) {
      const context = translated.map((c, i) => {
        const label = chunkFiles[i];
        return label ? `[${label}]\n${c.text}` : c.text;
      }).join("\n---\n");

      system += `\nKnowledge base context (use this as primary source):\n${context}\n`;
      system += "Each passage is labeled with its source filename in brackets. When citing, reference the document by its filename exactly as shown. ";
      if (imageUrlByFilename.size) system += "Relevant diagrams are displayed automatically to the user. Do not say there are no images. ";
      system += "If the answer is in the knowledge base, base your answer strictly on it. If not found, say so clearly.\n";
    }

    // 3. Build conversation string
    const conv = [...history, { role: "user", text: message }]
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");

    const prompt = system + conv + "\nAssistant:";

    // 4. Call Claude
    const text = await callClaude(prompt, { maxTokens: 2000 });

    // Replace [filename.png] citations with inline markdown images
    let renderedText = text;
    for (const [match, filename] of text.matchAll(/\[([^\]]+\.(?:png|jpg|jpeg|gif|bmp|webp))\]/gi)) {
      const url = imageUrlByFilename.get(filename);
      if (!url) continue;
      const alt = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      renderedText = renderedText.replaceAll(match, `\n\n![${alt}](${url})\n\n`);
    }
    // Clean up orphaned ":" lines left after image extraction (e.g. "sentence\n\n![img](url)\n\n :")
    renderedText = renderedText.replace(/\n\n(!\[[^\]]*\]\([^)]+\))\n\n\s*:\s*\n/g, '\n\n$1\n\n');
    renderedText = renderedText.replace(/^\s*:\s*$/gm, '');

    logger.info("Chat completion", { chunksUsed: translated.length, imagesReplaced: imageUrlByFilename.size });
    res.json({ text: renderedText, images: [] });
  } catch (err) {
    logger.error("Chat error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
