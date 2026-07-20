/**
 * graph/queries/document.js — KBDocument CRUD via SQLite.
 */

import { db }              from '../../shared.js';
import { deleteDocument as deleteS3Doc, deleteImage, deleteAllObjects } from '../../aws/s3.js';
import { imagePublicUrl }  from '../../aws/s3.js';
import { syncKnowledgeBase } from '../../aws/bedrock.js';
import { config }          from '../../utils/config.js';
import { logger }          from '../../utils/logger.js';

export function upsertDocument({ docId, filename, filepath, mimeType, language, summary, uploadedAt, wordCount, documentDate, s3Key, images = [] }) {
  db.prepare(`
    INSERT INTO documents (id, filename, filepath, mime_type, language, summary, uploaded_at, word_count, document_date, s3_key, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      filename      = excluded.filename,
      filepath      = excluded.filepath,
      mime_type     = excluded.mime_type,
      language      = excluded.language,
      summary       = excluded.summary,
      uploaded_at   = excluded.uploaded_at,
      word_count    = excluded.word_count,
      document_date = excluded.document_date,
      s3_key        = excluded.s3_key,
      images        = excluded.images
  `).run(docId, filename, filepath, mimeType ?? '', language ?? 'en', summary ?? '', uploadedAt, wordCount ?? 0, documentDate ?? null, s3Key ?? null, JSON.stringify(images));
}

export function listDocuments() {
  const rows = db.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC').all();
  return rows.map(r => ({
    id:           r.id,
    filename:     r.filename ?? '',
    filepath:     r.filepath ?? r.filename ?? '',
    mimeType:     r.mime_type ?? '',
    lang:         r.language ?? 'en',
    summary:      r.summary ?? '',
    uploadedAt:   r.uploaded_at ?? '',
    documentDate: r.document_date ?? null,
    wordCount:    r.word_count ?? 0,
    chunkCount:   0,
    s3Key:        r.s3_key ?? null,
    images:       JSON.parse(r.images ?? '[]'),
  }));
}

export async function deleteDocument(docId) {
  const row = db.prepare('SELECT s3_key, images FROM documents WHERE id = ?').get(docId);
  if (row) {
    if (row.s3_key) await deleteS3Doc(row.s3_key);
    const imageKeys = JSON.parse(row.images ?? '[]');
    for (const key of imageKeys) await deleteImage(key);
  }
  db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  await syncKnowledgeBase();
  logger.info('Document deleted', { docId });
}

/**
 * Wipes the knowledge base: both S3 buckets are emptied by listing, not by
 * following SQLite rows, so orphaned objects (uploaded before a failed DB write)
 * are removed too — otherwise they stay in the Bedrock index permanently.
 */
export async function resetDocuments() {
  const docs   = await deleteAllObjects(config.S3_BUCKET);
  const images = await deleteAllObjects(config.S3_IMAGES_BUCKET).catch(err => {
    logger.warn('Image bucket wipe failed', { error: err.message });
    return 0;
  });

  db.prepare('DELETE FROM documents').run();
  await syncKnowledgeBase().catch(() => {});
  logger.info('Knowledge base reset', { documentsDeleted: docs, imagesDeleted: images });
}

/** Overwrites the summary and image-key list for an existing document. */
export function updateDocumentPreview(docId, summary, images) {
  db.prepare('UPDATE documents SET summary = ?, images = ? WHERE id = ?')
    .run(summary ?? '', JSON.stringify(images ?? []), docId);
}

export function findDocumentIdsByFilepath(filepath) {
  return db.prepare('SELECT id FROM documents WHERE filepath = ?').all(filepath).map(r => r.id);
}

export function getDocumentsByIds(ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM documents WHERE id IN (${ph})`).all(...ids).map(r => ({
    id:           r.id,
    filename:     r.filename ?? '',
    documentDate: r.document_date ?? null,
  }));
}

export function getDocumentImagesByFilename(filename) {
  const rows = db.prepare('SELECT images FROM documents WHERE filename = ?').all(filename);
  return rows.flatMap(r => JSON.parse(r.images ?? '[]').map(key => imagePublicUrl(key)));
}
