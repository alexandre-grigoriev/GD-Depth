/**
 * ingestion/graphviz_renderer.js — render Graphviz DOT source to SVG buffers.
 *
 * Uses @hpcc-js/wasm (pure WASM — no system `dot` binary required).
 * The Graphviz instance is lazy-loaded and reused across calls.
 *
 * Output SVGs are resized to fit within SVG_MAX_WIDTH × SVG_MAX_HEIGHT (from config / .env).
 * Default: 800 × 600 px.  Aspect ratio is always preserved.
 * Resize rules (user-specified):
 *   1. Scale to width = SVG_MAX_WIDTH  → if resulting height ≤ SVG_MAX_HEIGHT: use it
 *   2. Otherwise scale to height = SVG_MAX_HEIGHT and calculate width
 */

import crypto from 'crypto';
import { Graphviz } from '@hpcc-js/wasm';
import { config }   from '../utils/config.js';
import { logger }   from '../utils/logger.js';

/** @type {import('@hpcc-js/wasm').Graphviz | null} */
let _gv = null;

async function getGraphviz() {
  if (!_gv) _gv = await Graphviz.load();
  return _gv;
}

/**
 * Reads the intrinsic size from the SVG's viewBox attribute and rewrites
 * the width/height attributes to fit within maxWidth × maxHeight px,
 * preserving the aspect ratio.
 *
 * @param {string} svg
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {string}
 */
function resizeSvg(svg, maxWidth, maxHeight) {
  const vbMatch = svg.match(/viewBox="[\d. ]+ [\d. ]+ ([\d.]+) ([\d.]+)"/);
  if (!vbMatch) return svg; // no viewBox — leave untouched

  const intrinsicW = parseFloat(vbMatch[1]);
  const intrinsicH = parseFloat(vbMatch[2]);
  if (!intrinsicW || !intrinsicH) return svg;

  // Rule: try width=maxWidth first; if height exceeds maxHeight, constrain by height instead
  let w, h;
  const hAtMaxW = maxWidth * (intrinsicH / intrinsicW);
  if (hAtMaxW <= maxHeight) {
    w = maxWidth;
    h = Math.round(hAtMaxW);
  } else {
    h = maxHeight;
    w = Math.round(maxHeight * (intrinsicW / intrinsicH));
  }

  // Replace width and height attributes on the <svg> opening tag
  return svg.replace(
    /(<svg\b[^>]*?)\bwidth="[^"]*"([^>]*?)\bheight="[^"]*"/,
    `$1width="${w}px"$2height="${h}px"`
  ).replace(
    /(<svg\b[^>]*?)\bheight="[^"]*"([^>]*?)\bwidth="[^"]*"/,
    `$1height="${h}px"$2width="${w}px"`
  );
}

/**
 * Renders a DOT source string to an SVG string.
 *
 * @param {string} dot  - raw DOT source (the contents of the graphviz fenced block)
 * @returns {Promise<string>}  - SVG markup string
 */
export async function dotToSvg(dot) {
  const gv = await getGraphviz();
  return gv.dot(dot);
}

/**
 * Renders all graphviz fenced blocks in a Markdown string to SVG, replacing
 * each block with an [IMAGE_REF:graphviz-<hash>.svg] token.
 *
 * Fenced block syntax recognised (attrs after language tag are ignored):
 *   ```graphviz ...
 *   <DOT source>
 *   ```
 *
 * @param {string} markdown  - raw Markdown text (after front-matter stripping)
 * @returns {Promise<{ markdown: string, generatedImages: Map<string, Buffer> }>}
 *   - `markdown`        — text with graphviz blocks replaced by IMAGE_REF tokens
 *   - `generatedImages` — zipPath-style key → SVG buffer, ready to merge into imageMap
 */
export async function renderGraphvizBlocks(markdown) {
  const GRAPHVIZ_BLOCK_RE = /^```graphviz[^\n]*\n([\s\S]*?)^```/gm;

  const maxWidth  = config.SVG_MAX_WIDTH;
  const maxHeight = config.SVG_MAX_HEIGHT;

  /** @type {Map<string, Buffer>} */
  const generatedImages = new Map();

  let result = markdown;
  const matches = [...markdown.matchAll(GRAPHVIZ_BLOCK_RE)];

  for (const match of matches) {
    const [fullBlock, dotSource] = match;
    const hash     = crypto.createHash('sha256').update(dotSource).digest('hex').slice(0, 12);
    const filename = `graphviz-${hash}.svg`;

    try {
      const rawSvg  = await dotToSvg(dotSource.trim());
      const svg     = resizeSvg(rawSvg, maxWidth, maxHeight);
      const buf     = Buffer.from(svg, 'utf8');
      const token   = `[IMAGE_REF:${filename}]`;

      generatedImages.set(filename, buf);
      result = result.replace(fullBlock, token);
    } catch (err) {
      logger.warn('Graphviz render failed — block removed', { filename, error: err.message });
      result = result.replace(fullBlock, '');
    }
  }

  return { markdown: result, generatedImages };
}
