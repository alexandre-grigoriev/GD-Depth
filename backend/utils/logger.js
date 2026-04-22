/**
 * utils/logger.js — structured logger
 */

const IS_PROD = process.env.NODE_ENV === 'production';

function formatDev(level, message, context) {
  const ts  = new Date().toISOString();
  const ctx = context ? ' ' + JSON.stringify(context) : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${ctx}`;
}

function formatProd(level, message, context) {
  return JSON.stringify({ ts: new Date().toISOString(), level, message, ...context });
}

function write(level, stream, message, context) {
  const line = IS_PROD
    ? formatProd(level, message, context)
    : formatDev(level, message, context);
  stream.write(line + '\n');
}

export const logger = {
  info:  (message, context) => write('info',  process.stdout, message, context),
  warn:  (message, context) => write('warn',  process.stderr, message, context),
  error: (message, context) => write('error', process.stderr, message, context),
  debug: (message, context) => { if (!IS_PROD) write('debug', process.stdout, message, context); },
};
