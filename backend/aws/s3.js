/**
 * aws/s3.js — S3 operations for document and image storage.
 *
 * uploadDocument(key, content)  — uploads enriched markdown text to the KB S3 bucket.
 * deleteDocument(key)           — removes a document from S3.
 * uploadImage(key, buffer, contentType) — uploads an extracted image to the images bucket.
 * imagePublicUrl(key)           — returns the HTTPS URL for a stored image.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand,
         ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const s3 = new S3Client({ region: config.AWS_REGION });

/**
 * Verifies both buckets are reachable. Ingestion only writes to S3 as its final
 * step, so without this a bad bucket name surfaces after several minutes of
 * Claude enrichment instead of immediately.
 *
 * @throws {Error} if the document bucket is missing or inaccessible
 */
export async function assertBucketsReachable() {
  for (const [name, bucket] of [['S3_BUCKET', config.S3_BUCKET], ['S3_IMAGES_BUCKET', config.S3_IMAGES_BUCKET]]) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const detail = `${name}="${bucket}" (region ${config.AWS_REGION}): ${err.name}`;
      // Images degrade gracefully — a missing image bucket only loses figures.
      if (name === 'S3_IMAGES_BUCKET') { logger.warn('S3 image bucket unreachable', { bucket, error: err.name }); continue; }
      throw new Error(`S3 bucket unreachable — ${detail}`);
    }
  }
}

/**
 * Deletes every object in a bucket, paginating through the full listing.
 *
 * Used by the knowledge-base reset: deleting only the keys recorded in SQLite
 * leaves orphans (upload succeeded, DB insert did not) that stay in the Bedrock
 * index forever. Listing is the only way to catch those.
 *
 * @param {string} bucket
 * @returns {Promise<number>} objects deleted
 */
export async function deleteAllObjects(bucket) {
  let deleted = 0;
  let ContinuationToken;

  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }));
    const keys = (page.Contents ?? []).map(o => ({ Key: o.Key }));

    if (keys.length > 0) {
      // DeleteObjects caps at 1000 keys, the same cap ListObjectsV2 returns per page.
      const result = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
      for (const err of result.Errors ?? []) logger.warn('S3 bulk delete failed for key', { bucket, key: err.Key, error: err.Message });
      deleted += keys.length - (result.Errors?.length ?? 0);
    }

    // A truncated page always carries a token; without this the loop would stop early.
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);

  logger.info('S3 bucket emptied', { bucket, deleted });
  return deleted;
}

/**
 * Uploads enriched document markdown to the Bedrock KB S3 data source bucket.
 *
 * @param {string} key     - S3 object key, e.g. 'documents/uuid/report.md'
 * @param {string} content - markdown text
 */
export async function uploadDocument(key, content) {
  await s3.send(new PutObjectCommand({
    Bucket:      config.S3_BUCKET,
    Key:         key,
    Body:        content,
    ContentType: 'text/markdown; charset=utf-8',
  }));
  logger.info('Document uploaded to S3', { bucket: config.S3_BUCKET, key });
}

/**
 * Deletes a document from the KB S3 bucket.
 *
 * @param {string} key
 */
export async function deleteDocument(key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    logger.info('Document deleted from S3', { key });
  } catch (err) {
    logger.warn('S3 document delete failed', { key, error: err.message });
  }
}

/**
 * Uploads an image buffer to the images S3 bucket.
 *
 * @param {string} key         - S3 object key, e.g. 'uuid/image.png'
 * @param {Buffer} buffer
 * @param {string} [contentType='image/png']
 */
export async function uploadImage(key, buffer, contentType = 'image/png') {
  await s3.send(new PutObjectCommand({
    Bucket:      config.S3_IMAGES_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
  }));
}

/**
 * Deletes an image from the images S3 bucket.
 *
 * @param {string} key
 */
export async function deleteImage(key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.S3_IMAGES_BUCKET, Key: key }));
    logger.info('Image deleted from S3', { key });
  } catch (err) {
    logger.warn('S3 image delete failed', { key, error: err.message });
  }
}

/**
 * Returns the public HTTPS URL for an image stored in the images bucket.
 * Assumes the bucket is publicly readable (or adjust to use pre-signed URLs).
 *
 * @param {string} key
 * @returns {string}
 */
/**
 * Downloads an enriched markdown document from the KB S3 bucket and returns it as a string.
 *
 * @param {string} key
 * @returns {Promise<string>}
 */
export async function downloadDocument(key) {
  const res    = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function imagePublicUrl(key) {
  const encoded = key.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `https://${config.S3_IMAGES_BUCKET}.s3.${config.AWS_REGION}.amazonaws.com/${encoded}`;
}
