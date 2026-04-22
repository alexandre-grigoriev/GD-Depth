/**
 * ingestion/image_resolver.js — resolve [IMAGE_REF:path] tokens, upload images to S3.
 */

import { uploadImage, imagePublicUrl } from '../aws/s3.js';
import { logger } from '../utils/logger.js';

const IMAGE_REF_RE = /\[IMAGE_REF:([^\]]+)\]/g;

/**
 * @typedef {{ key: string, url: string }} ResolvedImage
 * @typedef {{ cleanText: string, images: ResolvedImage[] }} ResolvedChunk
 */

/**
 * Resolves [IMAGE_REF:path] tokens: uploads each image to S3, returns clean text and image info.
 *
 * @param {{ index: number, text: string, wordCount: number }} chunk
 * @param {string}              docId
 * @param {string}              mdFilePath
 * @param {Map<string, Buffer>} imageMap
 * @returns {Promise<ResolvedChunk>}
 */
export async function resolveChunkImages(chunk, docId, mdFilePath, imageMap) {
  const images = [];
  const mdDir = mdFilePath.includes('/') ? mdFilePath.split('/').slice(0, -1).join('/') : '';
  const matches = [...chunk.text.matchAll(IMAGE_REF_RE)];

  for (const [, imgRef] of matches) {
    const resolvedZipPath = resolveZipPath(mdDir, imgRef);

    if (resolvedZipPath.includes('../') || resolvedZipPath.startsWith('/')) {
      logger.warn('Image path traversal rejected', { imgRef, resolvedZipPath });
      continue;
    }

    const buf = imageMap.get(resolvedZipPath);
    if (!buf) {
      logger.warn('Image not found in imageMap', { imgRef, resolvedZipPath, docId });
      continue;
    }

    const ext = resolvedZipPath.split('.').pop()?.toLowerCase() ?? 'png';
    const contentType = ext === 'svg' ? 'image/svg+xml'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : 'image/png';

    const key = `${docId}/${resolvedZipPath}`;
    try {
      await uploadImage(key, buf, contentType);
      images.push({ key, url: imagePublicUrl(key) });
    } catch (err) {
      logger.warn('Image upload to S3 failed — skipping', { key, error: err.message });
    }
  }

  const cleanText = chunk.text
    .replace(IMAGE_REF_RE, '')
    .replace(/  +/g, ' ')
    .trim();

  return { cleanText, images };
}

function resolveZipPath(mdDir, imgRef) {
  const cleaned = imgRef.replace(/^\.\//, '');
  if (mdDir) {
    return normalisePosix(`${mdDir}/${cleaned}`);
  }
  return normalisePosix(cleaned);
}

function normalisePosix(p) {
  const parts = p.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.') result.push(part);
  }
  return result.join('/');
}
