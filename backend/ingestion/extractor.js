/**
 * ingestion/extractor.js — text extraction from PDF, Markdown, DOCX, TXT, PPTX/PPT.
 */

import pdfParse from 'pdf-parse';
import mammoth  from 'mammoth';
import JSZip    from 'jszip';

export async function extractText(fileBuffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'pdf')                       return extractPdf(fileBuffer);
  if (ext === 'md' || ext === 'markdown')  return extractMarkdown(fileBuffer);
  if (ext === 'docx')                      return extractDocx(fileBuffer);
  if (ext === 'txt')                       return extractTxt(fileBuffer);
  if (ext === 'pptx' || ext === 'ppt')     return extractPptx(fileBuffer);

  throw new Error(`Unsupported file type: .${ext}. Supported: pdf, md, docx, txt, pptx`);
}

// ── PDF ────────────────────────────────────────────────────────────────────────

async function extractPdf(buffer) {
  const parsed = await pdfParse(buffer);
  let text = parsed.text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ');
  return { text: normalise(text), imageRefs: [], generatedImages: new Map(), dotContent: '', mimeType: 'pdf' };
}

// ── Markdown ───────────────────────────────────────────────────────────────────

async function extractMarkdown(buffer) {
  let text = buffer.toString('utf8');

  // Strip YAML front matter
  text = text.replace(/^---[\s\S]*?---\s*\n?/, '');

  // Strip fenced code blocks (including graphviz)
  text = text.replace(/```[^\n]*\n[\s\S]*?```/gm, '');

  // Strip image references completely (no IMAGE_REF tokens)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Strip remaining markdown syntax
  text = text.replace(/`[^`]*`/g, '');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1');
  text = text.replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/<[^>]+>/g, '');

  return { text: normalise(text), imageRefs: [], generatedImages: new Map(), dotContent: '', mimeType: 'md' };
}

// ── DOCX ───────────────────────────────────────────────────────────────────────

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text   = result.value.replace(/<[^>]+>/g, '');
  return { text: normalise(text), imageRefs: [], generatedImages: new Map(), dotContent: '', mimeType: 'docx' };
}

// ── TXT ────────────────────────────────────────────────────────────────────────

function extractTxt(buffer) {
  return { text: normalise(buffer.toString('utf8')), imageRefs: [], generatedImages: new Map(), dotContent: '', mimeType: 'txt' };
}

// ── PPTX / PPT ─────────────────────────────────────────────────────────────────

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  // Slides live at ppt/slides/slide1.xml, slide2.xml, etc.
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const num = s => parseInt(s.match(/\d+/)?.[0] ?? '0', 10);
      return num(a) - num(b);
    });

  const slideTexts = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async('text');
    // Extract text from <a:t> elements
    const tokens = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map(m => m[1].trim())
      .filter(Boolean);
    if (tokens.length) slideTexts.push(tokens.join(' '));
  }

  return { text: normalise(slideTexts.join('\n\n')), imageRefs: [], generatedImages: new Map(), dotContent: '', mimeType: 'pptx' };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalise(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}
