/**
 * retrieval/query_pipeline.js — retrieves chunks from Bedrock Knowledge Base.
 *
 * Calls retrieveFromKB(), parses [img:key] tokens from returned chunk text,
 * looks up document metadata (filename, documentDate) via SQLite.
 */

import { retrieveFromKB }    from '../aws/bedrock.js';
import { imagePublicUrl }    from '../aws/s3.js';
import { getDocumentsByIds } from '../graph/queries/document.js';

const DEFAULT_TOP_K = 10;
const IMG_TOKEN_RE  = /\[img:([^\]]+)\]/g;

function extractDocId(sourceUri) {
  if (!sourceUri) return null;
  // s3://bucket/prefix/docId/filename.md  →  parts[-2] is docId
  const parts = sourceUri.replace(/^s3:\/\/[^/]+\//, '').split('/');
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

/**
 * @param {string} query
 * @param {number} [topK]
 * @returns {Promise<Array<{text: string, enrichedText: string, images: string[], filename: string|null, documentDate: string|null, chunkId: string, docId: string}>>}
 */
export async function searchKnowledgeBase(query, topK = DEFAULT_TOP_K) {
  const results = await retrieveFromKB(query, topK);

  // Batch-load doc metadata for all unique docIds
  const docIds = [...new Set(results.map(r => extractDocId(r.sourceUri)).filter(Boolean))];
  const docMeta = new Map();
  if (docIds.length) {
    for (const doc of await getDocumentsByIds(docIds)) {
      docMeta.set(doc.id, doc);
    }
  }

  return results.map((r, i) => {
    // Extract [img:key] tokens → public URLs
    const images = [];
    for (const [, key] of r.text.matchAll(IMG_TOKEN_RE)) {
      images.push(imagePublicUrl(key));
    }
    const cleanText = r.text.replace(IMG_TOKEN_RE, '').replace(/\s+/g, ' ').trim();

    const docId = extractDocId(r.sourceUri);
    const doc   = docId ? docMeta.get(docId) : null;

    return {
      chunkId:      r.sourceUri ? `${r.sourceUri}#${i}` : `chunk_${i}`,
      docId:        docId ?? `unknown_${i}`,
      enrichedText: cleanText,
      text:         cleanText,
      images,
      filename:     doc?.filename ?? null,
      documentDate: doc?.documentDate ?? null,
      score:        r.score,
    };
  });
}

export { translateChunks } from './translator.js';
