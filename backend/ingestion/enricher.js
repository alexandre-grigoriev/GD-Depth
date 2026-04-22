/**
 * ingestion/enricher.js — Gemini enrichment: entity/relation extraction + text rewrite.
 *
 * Per RAG_PIPELINE.md A.3 and A.6.
 * generateDocumentSummary() — summarises the first 3000 chars of a document.
 * enrichChunk()             — rewrites a chunk and extracts entities + relations.
 *
 * On Gemini JSON parse failure: returns cleanText as enrichedText, empty arrays.
 * Retries once on HTTP 429 or 503 (handled inside callGeminiJson/callGemini).
 * Never throws — always returns a valid result.
 */

import { callGemini, callGeminiJson } from './embedder.js';
import { logger } from '../utils/logger.js';

/**
 * Best-effort repair of a truncated JSON string from Gemini.
 * If Gemini hits maxOutputTokens mid-JSON, the response is cut off.
 * Strategy: close any open arrays/objects so JSON.parse has a chance.
 *
 * @param {string} raw
 * @returns {string}
 */
function repairTruncatedJson(raw) {
  const s = raw.trim();
  // Track open brackets to close them
  const stack = [];
  let inString = false;
  let escape   = false;
  for (const ch of s) {
    if (escape)          { escape = false; continue; }
    if (ch === '\\')     { escape = true;  continue; }
    if (ch === '"')      { inString = !inString; continue; }
    if (inString)        continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    if (ch === '}' || ch === ']') stack.pop();
  }
  // Close any unclosed structures
  return s + stack.reverse().join('');
}

/**
 * @typedef {object} Entity
 * @property {string} key         - canonical snake_case identifier, e.g. "raman_spectrometer"
 * @property {string} type        - DEVICE|CONCEPT|PROCESS|PERSON|LOCATION|ORGANIZATION|OTHER
 * @property {string} description - one-sentence definition
 */

/**
 * @typedef {object} Relation
 * @property {string} fromKey
 * @property {string} toKey
 * @property {string} relation - USES|PART_OF|PRODUCES|REQUIRES|CONNECTS_TO|DESCRIBED_BY|OTHER
 */

/**
 * @typedef {object} EnrichedChunk
 * @property {string}     enrichedText
 * @property {Entity[]}   entities
 * @property {Relation[]} relations
 */

const SYSTEM_INSTRUCTION = `You are a technical documentation analyst.
You extract structured information from documentation chunks.
Always respond with valid JSON matching the schema exactly.`;

/**
 * Generates a 2–3 sentence summary of a document using the first 3000 characters.
 * Per RAG_PIPELINE.md A.3.
 *
 * @param {string} text - full extracted document text
 * @returns {Promise<string>} - summary string (empty string on failure)
 */
export async function generateDocumentSummary(text) {
  const sample = text.slice(0, 3000);
  const prompt = `Summarize the following technical documentation in 2–3 sentences.
Focus on the main topic, key concepts, and purpose.
Use the file path (if provided) as additional context to understand what the document is about.
If the content is a diagram (DOT/Graphviz source), describe what the diagram represents.
Output only the summary, no preamble.

DOCUMENT:
${sample}`;

  try {
    return await callGemini(prompt, { maxTokens: 300 });
  } catch (error) {
    logger.warn('Document summary failed — using empty string', { error: error.message });
    return '';
  }
}

/**
 * Rewrites a chunk as a self-contained paragraph and extracts named entities and relations.
 * Per RAG_PIPELINE.md A.6.
 *
 * On JSON parse failure: returns cleanText as enrichedText, empty entities and relations.
 * Never throws.
 *
 * @param {string} cleanText        - chunk text with IMAGE_REF tokens removed
 * @param {string} documentSummary  - document-level summary for context
 * @param {number} chunkIndex       - 0-based position in document
 * @param {number} totalChunks      - total chunk count in document
 * @returns {Promise<EnrichedChunk>}
 */
export async function enrichChunk(cleanText, documentSummary, chunkIndex, totalChunks, filepath = '') {
  const fileCtx = filepath ? `Source file: ${filepath}\n` : '';
  const prompt = `${fileCtx}DOCUMENT CONTEXT:
${documentSummary}

CHUNK ${chunkIndex + 1} of ${totalChunks}:
${cleanText}

Your tasks:
1. Rewrite this chunk as a self-contained paragraph. Resolve any pronouns
   to their referents. Add a one-sentence context prefix using the document summary.
   Keep technical terms exact. Output as "enrichedText".

2. Extract named entities. For each, provide:
   - key: canonical snake_case identifier (stable across documents)
   - type: one of DEVICE | CONCEPT | PROCESS | PERSON | LOCATION | ORGANIZATION | OTHER
   - description: one sentence defining this entity in this context

3. Extract relations between extracted entities only.
   Each relation: { fromKey, toKey, relation }
   Relation verbs: USES | PART_OF | PRODUCES | REQUIRES | CONNECTS_TO | DESCRIBED_BY | OTHER

Respond ONLY with this JSON structure:
{
  "enrichedText": "...",
  "entities": [{ "key": "...", "type": "...", "description": "..." }],
  "relations": [{ "fromKey": "...", "toKey": "...", "relation": "..." }]
}`;

  try {
    const raw = await callGeminiJson(SYSTEM_INSTRUCTION, prompt, { maxTokens: 4000 });
    const parsed = JSON.parse(repairTruncatedJson(raw));

    // Validate required fields; fall back gracefully on malformed response
    if (typeof parsed.enrichedText !== 'string') {
      throw new Error('enrichedText missing in Gemini response');
    }

    // Normalise entity keys to snake_case for stability across documents
    const entities = (Array.isArray(parsed.entities) ? parsed.entities : [])
      .filter(e => e && typeof e.key === 'string')
      .map(e => ({
        key:         e.key.toLowerCase().replace(/\s+/g, '_'),
        type:        e.type        || 'OTHER',
        description: e.description || '',
      }));

    const relations = (Array.isArray(parsed.relations) ? parsed.relations : [])
      .filter(r => r && typeof r.fromKey === 'string' && typeof r.toKey === 'string');

    return { enrichedText: parsed.enrichedText, entities, relations };
  } catch (error) {
    logger.warn('Chunk enrichment failed — using cleanText fallback', {
      chunkIndex,
      error: error.message,
    });
    return { enrichedText: cleanText, entities: [], relations: [] };
  }
}
