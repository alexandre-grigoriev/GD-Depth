/**
 * ingestion/pipeline.js — orchestrates ingestion for Option B (Bedrock KB + S3).
 *
 * Per-document steps:
 *   1. extractText
 *   2. detectLanguage
 *   3. generateDocumentSummary
 *   4. chunkText
 *   5. For each chunk: resolveChunkImages → enrichChunk → collect
 *   6. Assemble enriched markdown and upload to S3
 *   7. Trigger Bedrock KB sync
 *   8. Save document metadata to SQLite
 */

import crypto                      from 'crypto';
import { extractText }             from './extractor.js';
import { chunkText }               from './chunker.js';
import { resolveChunkImages }      from './image_resolver.js';
import { generateDocumentSummary, enrichChunk } from './enricher.js';
import { upsertDocument }          from '../graph/queries/document.js';
import { uploadDocument, assertBucketsReachable } from '../aws/s3.js';
import { syncKnowledgeBase }       from '../aws/bedrock.js';
import { config }                  from '../utils/config.js';
import { logger }                  from '../utils/logger.js';

const FRENCH_WORDS = ['le','la','les','de','du','des','un','une','et','est','en','pour','dans','que','qui'];

function detectLanguage(text) {
  const sample  = text.slice(0, 500).toLowerCase();
  const words   = sample.split(/\s+/);
  const frCount = words.filter(w => FRENCH_WORDS.includes(w)).length;
  return frCount >= 3 ? 'fr' : 'en';
}

function buildSummaryInput(text, dotContent, filepath) {
  const header    = filepath ? `File: ${filepath}\n\n` : '';
  const cleanText = text.replace(/\[IMAGE_REF:[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();

  if (cleanText.length >= 50) return (header + cleanText).slice(0, 3000);
  if (dotContent) return `${header}This file contains a diagram.\n\n${dotContent.slice(0, 2800)}`;
  return header || '(no content)';
}

/**
 * Ingests a single document into the Bedrock KB pipeline.
 *
 * @param {object}                opts
 * @param {Buffer}                opts.buffer
 * @param {string}                opts.filename
 * @param {string}                [opts.uploadedBy]
 * @param {string|null}           [opts.documentDate]
 * @param {Map<string, Buffer>}   [opts.zipImages]
 * @param {string}                [opts.zipDir]
 * @param {string}                [opts.filepath]
 * @param {function}              [opts.onProgress]
 * @returns {Promise<{ docId: string, filename: string, lang: string, chunkCount: number, entitiesWritten: number, summary: string }>}
 */
export async function ingestDocument({ buffer, filename, uploadedBy, documentDate = null, zipImages, zipDir, filepath, onProgress }) {
  const docId    = crypto.randomUUID();
  const imageMap = zipImages instanceof Map ? zipImages : new Map();
  const mdFilePath      = zipDir ? `${zipDir}/${filename}` : filename;
  const resolvedFilepath = filepath ?? mdFilePath;

  // ── Step 0: Fail fast on S3 misconfiguration, before any LLM work ────────────
  await assertBucketsReachable();

  // ── Step 1: Text extraction ──────────────────────────────────────────────────
  let extraction;
  try {
    extraction = await extractText(buffer, filename);
  } catch (error) {
    logger.error('Text extraction failed', { docId, filename, error: error.message });
    throw error;
  }

  const { text, mimeType, generatedImages, dotContent } = extraction;

  if (generatedImages instanceof Map) {
    const mdDir = mdFilePath.includes('/') ? mdFilePath.split('/').slice(0, -1).join('/') : '';
    for (const [key, buf] of generatedImages) {
      imageMap.set(mdDir ? `${mdDir}/${key}` : key, buf);
    }
  }

  if (!text?.trim()) throw new Error(`No text extracted from ${filename}`);

  // ── Step 2: Language ─────────────────────────────────────────────────────────
  const language  = detectLanguage(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // ── Step 3: Summary ──────────────────────────────────────────────────────────
  let summary = '';
  try {
    summary = await generateDocumentSummary(buildSummaryInput(text, dotContent, resolvedFilepath));
  } catch (error) {
    logger.warn('Document summary failed', { docId, filename, error: error.message });
  }

  onProgress?.(`Extracted ${wordCount} words (${language})`);

  // ── Step 4–5: Chunk + enrich ─────────────────────────────────────────────────
  const chunks      = chunkText(text);
  const allImageKeys = [];
  const sections    = [];
  let chunkCount    = 0;
  let failedChunks  = 0;

  onProgress?.(`Split into ${chunks.length} chunks`);

  for (const chunk of chunks) {
    try {
      const { cleanText, images } = await resolveChunkImages(chunk, docId, mdFilePath, imageMap);
      const { enrichedText }      = await enrichChunk(cleanText, summary, chunk.index, chunks.length, resolvedFilepath);

      for (const img of images) allImageKeys.push(img.key);

      let section = enrichedText;
      if (images.length > 0) {
        section += '\n' + images.map(img => `[img:${img.key}]`).join(' ');
      }
      sections.push(section);
      chunkCount++;
      onProgress?.(`Chunk ${chunk.index + 1}/${chunks.length} done`);
    } catch (error) {
      failedChunks++;
      logger.error('Chunk processing failed — skipping', { docId, chunkIndex: chunk.index, error: error.message });
    }
  }

  if (failedChunks > chunks.length / 2) {
    logger.warn('Over 50% of chunks failed', { docId, filename, failedChunks, totalChunks: chunks.length });
  }

  // ── Step 6: Upload enriched markdown to S3 ───────────────────────────────────
  const basename = filename.replace(/\.[^.]+$/, '');
  const s3Key    = `${config.S3_DOC_PREFIX}/${docId}/${basename}.md`;

  const mdContent = [
    `# ${filename}`,
    `**Summary:** ${summary}`,
    '',
    ...sections.flatMap(s => [s, '\n---\n']),
  ].join('\n');

  await uploadDocument(s3Key, mdContent);

  // ── Step 7: Trigger KB sync ──────────────────────────────────────────────────
  await syncKnowledgeBase();

  // ── Step 8: Save to SQLite ───────────────────────────────────────────────────
  upsertDocument({
    docId, filename, filepath: resolvedFilepath, mimeType, language,
    summary, uploadedAt: new Date().toISOString(), wordCount, documentDate,
    s3Key, images: allImageKeys,
  });

  logger.info('Document ingested', { docId, filename, chunkCount, s3Key });
  return { docId, filename, lang: language, chunkCount, entitiesWritten: 0, summary };
}
