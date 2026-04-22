/**
 * kb.js — re-export facade for knowledge base modules.
 */

export { SUPPORTED_EXTS }                    from './utils/config.js';
export { initSchema as initKnowledgeBase }   from './graph/schema.js';
export { listDocuments, deleteDocument, resetDocuments } from './graph/queries/document.js';
export { ingestDocument }                    from './ingestion/pipeline.js';
export { searchKnowledgeBase, translateChunks } from './retrieval/query_pipeline.js';
export { extractText }                       from './ingestion/extractor.js';
