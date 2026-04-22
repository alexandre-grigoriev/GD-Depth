/**
 * ingestion/chunker.js — section-aware chunker with sliding-window fallback.
 *
 * Primary strategy: split on markdown headers (## / ###) so each section
 * stays in one chunk with its title. For documents without headers, split
 * on paragraph blocks (blank lines). This prevents "Sample: cyclohexane"
 * headings from being separated from their tables, which caused the LLM to
 * cross-associate peaks with wrong samples.
 *
 * Fallback: sections > MAX_CHUNK_WORDS are sub-chunked with a sliding window.
 * Sections < MIN_WORDS are merged with the next section.
 */

const WINDOW_SIZE     = 500;
const STEP_SIZE       = 450; // 50-word overlap
const MIN_WORDS       = 20;
const MAX_CHUNK_WORDS = 500;

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function slidingWindow(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const result = [];
  let pos = 0;
  while (pos < words.length) {
    const slice = words.slice(pos, pos + WINDOW_SIZE);
    const joined = slice.join(' ');
    if (slice.length >= MIN_WORDS || joined.includes('[IMAGE_REF:')) {
      result.push(joined);
    }
    pos += STEP_SIZE;
  }
  return result;
}

/**
 * Split text into logical sections:
 * 1. If the document has markdown headers (## / ###), split on those.
 * 2. Otherwise split on paragraph blocks (two or more blank lines).
 */
function splitIntoSections(text) {
  const lines = text.split('\n');
  const headerPattern = /^#{1,4} /;
  const hasHeaders = lines.some(l => headerPattern.test(l));

  if (hasHeaders) {
    const sections = [];
    let current = [];
    for (const line of lines) {
      if (headerPattern.test(line) && current.length > 0) {
        sections.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) sections.push(current.join('\n'));
    return sections;
  }

  // No headers — split on blank lines, keeping each block intact
  return text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
}

/**
 * @typedef {object} Chunk
 * @property {number} index
 * @property {string} text
 * @property {number} wordCount
 */

/**
 * Splits text into section-aware chunks.
 *
 * @param {string} text - full extracted text (with IMAGE_REF tokens)
 * @returns {Chunk[]}
 */
export function chunkText(text) {
  const sections = splitIntoSections(text);
  const rawChunks = [];
  let pending = '';

  for (const section of sections) {
    const combined = pending ? pending + '\n\n' + section : section;
    const wc = countWords(combined);

    if (wc < MIN_WORDS && !combined.includes('[IMAGE_REF:')) {
      // Too small — carry forward and merge with next section
      pending = combined;
    } else if (wc <= MAX_CHUNK_WORDS) {
      // Good size — emit as-is
      rawChunks.push(combined);
      pending = '';
    } else {
      // Too large — flush pending first, then sub-chunk this section
      if (pending) { rawChunks.push(pending); pending = ''; }
      const subs = slidingWindow(section);
      rawChunks.push(...subs);
    }
  }

  // Flush any remaining pending content
  if (pending && (countWords(pending) >= MIN_WORDS || pending.includes('[IMAGE_REF:'))) {
    rawChunks.push(pending);
  }

  return rawChunks.map((t, i) => ({
    index:     i,
    text:      t.trim(),
    wordCount: countWords(t.trim()),
  }));
}
