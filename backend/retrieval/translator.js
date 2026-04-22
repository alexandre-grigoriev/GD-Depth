/**
 * retrieval/translator.js — batch-translate FR chunks to target language via Gemini.
 *
 * Per RAG_PIPELINE.md B.5:
 * - Skip entirely if targetLanguage === 'fr'
 * - Batch all chunks into a single Gemini call
 * - Parse response by [N] markers
 * - On any failure: keep original text, never throw
 */

import { callGemini } from '../ingestion/embedder.js';
import { logger }     from '../utils/logger.js';

const LANG_NAMES = {
  en: 'English',
  fr: 'French',
  ar: 'Arabic',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese',
  ru: 'Russian',
};

/**
 * @typedef {import('./strategies.js').ScoredChunk} ScoredChunk
 */

/**
 * Translates enrichedText of each chunk to the target language.
 * Writes the result into the `text` property so downstream code reads the right field.
 *
 * @param {ScoredChunk[]} chunks
 * @param {string}        targetLanguage - BCP-47 code, e.g. 'en', 'fr'
 * @returns {Promise<ScoredChunk[]>}
 */
export async function translateChunks(chunks, targetLanguage) {
  // Per spec: skip entirely when target is French
  if (!chunks.length || targetLanguage === 'fr') {
    return chunks.map(c => ({ ...c, text: c.enrichedText ?? c.text }));
  }

  const langName = LANG_NAMES[targetLanguage] ?? targetLanguage;

  // Build numbered passages — use enrichedText as source
  const passages = chunks.map((c, i) => `[${i + 1}]\n${c.enrichedText ?? c.text}`).join('\n\n');

  const prompt = `Translate each numbered passage to ${langName}.
Preserve technical terms, product names, and formatting exactly.
Output ONLY the translated passages numbered the same way.

${passages}`;

  try {
    const result = await callGemini(prompt, { maxTokens: 4000 });

    // Parse by [N] markers — split on lines that start with "[digit"
    const translated = parseNumberedPassages(result, chunks.length);

    return chunks.map((c, i) => ({
      ...c,
      text: translated[i] ?? c.enrichedText ?? c.text,
    }));
  } catch (error) {
    logger.warn('Batch translation failed — keeping original enrichedText', {
      targetLanguage,
      chunkCount: chunks.length,
      error: error.message,
    });
    // Never throw — fall back to enrichedText
    return chunks.map(c => ({ ...c, text: c.enrichedText ?? c.text }));
  }
}

/**
 * Parses a Gemini response that contains [N] numbered passages.
 *
 * @param {string} response
 * @param {number} expectedCount
 * @returns {string[]} - indexed 0-based (passage [1] → index 0)
 */
function parseNumberedPassages(response, expectedCount) {
  const result = new Array(expectedCount).fill(null);
  // Match [N] followed by text up to the next [N] or end of string
  const re = /\[(\d+)\]\s*([\s\S]*?)(?=\n?\[\d+\]|$)/g;
  let match;
  while ((match = re.exec(response)) !== null) {
    const idx = parseInt(match[1], 10) - 1; // convert 1-based to 0-based
    if (idx >= 0 && idx < expectedCount) {
      result[idx] = match[2].trim();
    }
  }
  return result;
}
