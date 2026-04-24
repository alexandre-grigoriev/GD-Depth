/**
 * utils/config.js — centralised environment variable access.
 * All values sourced from .env (mirroring python/settings.json for AWS keys).
 */

const REQUIRED = [
  'AWS_REGION',
  'KB_ID',
  'KB_DATA_SOURCE_ID',
  'S3_BUCKET',
  'S3_IMAGES_BUCKET',
];

const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `[config] Missing required environment variables: ${missing.join(', ')}.\n` +
    `Check your .env file.`
  );
}

export const config = {
  // AWS
  AWS_REGION: process.env.AWS_REGION,

  // Bedrock Knowledge Base (from python/settings.json knowledge_base_id / data_source_id)
  KB_ID:             process.env.KB_ID,
  KB_DATA_SOURCE_ID: process.env.KB_DATA_SOURCE_ID,

  // S3 buckets (from python/settings.json s3_name / s3-images)
  S3_BUCKET:        process.env.S3_BUCKET,         // document storage  → kb-ds-ai4gd
  S3_IMAGES_BUCKET: process.env.S3_IMAGES_BUCKET,  // image storage     → aisav-chat-images
  S3_DOC_PREFIX:    process.env.S3_DOC_PREFIX || 'gd-depth',  // key prefix inside S3_BUCKET

  // Bedrock model IDs
  BEDROCK_TEXT_MODEL_ID: process.env.BEDROCK_TEXT_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',

  // SQLite
  DB_PATH: process.env.DB_PATH || './users.db',

  // Server
  PORT:         parseInt(process.env.PORT || '3001', 10),
  FRONTEND_URL: process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173',

  // Auth
  COOKIE_NAME:     process.env.COOKIE_NAME     || 'gd_session',
  COOKIE_SECURE:   String(process.env.COOKIE_SECURE || 'false') === 'true',
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE  || 'lax',
  SESSION_SECRET:  process.env.SESSION_SECRET   || '',

  // SMTP (optional)
  SMTP_HOST:     process.env.SMTP_HOST     || '',
  SMTP_PORT:     parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER:     process.env.SMTP_USER     || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',

  // Google OAuth (optional)
  GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // SVG rendering
  SVG_MAX_WIDTH:  parseInt(process.env.SVG_MAX_WIDTH  || '800', 10),
  SVG_MAX_HEIGHT: parseInt(process.env.SVG_MAX_HEIGHT || '600', 10),

  NODE_ENV: process.env.NODE_ENV || 'development',
};

export const SUPPORTED_EXTS = ['pdf', 'md', 'markdown', 'docx', 'txt', 'pptx', 'ppt'];
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'tiff', 'tif']);
