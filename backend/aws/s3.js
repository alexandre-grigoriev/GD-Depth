/**
 * aws/s3.js — S3 operations for document and image storage.
 *
 * uploadDocument(key, content)  — uploads enriched markdown text to the KB S3 bucket.
 * deleteDocument(key)           — removes a document from S3.
 * uploadImage(key, buffer, contentType) — uploads an extracted image to the images bucket.
 * imagePublicUrl(key)           — returns the HTTPS URL for a stored image.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const s3 = new S3Client({ region: config.AWS_REGION });

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
