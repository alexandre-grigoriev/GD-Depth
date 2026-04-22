import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronDown, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "../../utils";

interface KBDocument { id: string; filename: string; filepath: string; lang: string; summary: string; chunkCount: number; uploadedAt: string; documentDate?: string; }
interface ProgressEntry { filename: string; chunkCount?: number; error?: string; ok: boolean; }

/** Groups a flat doc list into a folder tree keyed by folder path. */
function buildTree(docs: KBDocument[]): Map<string, KBDocument[]> {
  const tree = new Map<string, KBDocument[]>();
  for (const doc of docs) {
    const parts = (doc.filepath || doc.filename).split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    if (!tree.has(folder)) tree.set(folder, []);
    tree.get(folder)!.push(doc);
  }
  // Sort folders: root first, then alphabetically
  return new Map([...tree.entries()].sort((a, b) => {
    if (a[0] === "") return -1;
    if (b[0] === "") return 1;
    return a[0].localeCompare(b[0]);
  }));
}

const ACCEPT = ".pdf,.md,.markdown,.docx";

export function AddPdfDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"add" | "batch" | "docs" | "manage">("add");
  const [resetting, setResetting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  // Single file
  const [file, setFile] = useState<File | null>(null);
  const [documentDate, setDocumentDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Batch
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);

  const [docs, setDocs] = useState<KBDocument[]>([]);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [docImages, setDocImages]   = useState<Record<string, string[]>>({});
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  // update: docId → { file, uploading, error, success }
  const [updating, setUpdating]     = useState<Record<string, { file: File | null; uploading: boolean; error: string; success: string }>>({});
  const updateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const batchInputRef = useRef<HTMLInputElement>(null);
  const progressRef   = useRef<HTMLDivElement>(null);

  async function loadDocs() {
    try {
      const res = await fetch("/api/knowledge-base/documents", { credentials: "include" });
      if (res.ok) setDocs(await res.json());
    } catch {}
  }

  useEffect(() => {
    if (open) {
      setFile(null); setDocumentDate(""); setError(""); setSuccess("");
      setBatchFile(null); setProgress([]); setCurrentFile(null);
      setTab("add"); setResetConfirm(false);
      loadDocs();
    }
  }, [open]);

  // Auto-scroll progress log
  useEffect(() => {
    if (progressRef.current) progressRef.current.scrollTop = progressRef.current.scrollHeight;
  }, [progress, currentFile]);

  function clearTab() { setError(""); setSuccess(""); }

  async function doReset() {
    setResetting(true);
    try {
      await fetch("/api/knowledge-base/reset", { method: "DELETE", credentials: "include" });
      setDocs([]); setResetConfirm(false);
    } catch { setError("Reset failed"); }
    finally { setResetting(false); }
  }

  // ── Single file upload ──────────────────────────────────────────────────────

  async function doUpload() {
    if (!file) return;
    setUploading(true); setError(""); setSuccess("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (documentDate) form.append("documentDate", documentDate);
      const res = await fetch("/api/knowledge-base/upload", { method: "POST", credentials: "include", body: form });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Upload failed"); }
      const data = await res.json();
      setSuccess(`"${data.filename}" ingested — ${data.chunkCount} chunks.`);
      setFile(null);
      loadDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Batch upload with SSE progress ─────────────────────────────────────────

  async function doBatch() {
    if (!batchFile) return;
    setBatchRunning(true); setBatchDone(false); setProgress([]); setCurrentFile(null); setError("");

    // 1. Upload ZIP, get jobId
    let jobId: string;
    try {
      const form = new FormData();
      form.append("files", batchFile);
      const res = await fetch("/api/knowledge-base/upload-batch", { method: "POST", credentials: "include", body: form });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Upload failed"); }
      jobId = (await res.json()).jobId;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBatchRunning(false);
      return;
    }

    // 2. Connect to SSE progress stream with auto-reconnect
    // The backend queues events while disconnected, so reconnecting replays only missed events.
    // A deduplication set prevents the same file appearing twice across reconnects.
    const seen = new Set<string>();
    let reconnects = 0;
    const MAX_RECONNECTS = 30; // ~90 s of retries before giving up

    function connectSSE() {
      const es = new EventSource(`/api/knowledge-base/batch-progress/${jobId}`);

      es.addEventListener("processing", (e) => {
        const { filename } = JSON.parse(e.data);
        setCurrentFile(filename);
      });

      es.addEventListener("file_done", (e) => {
        const { filename, chunkCount } = JSON.parse(e.data);
        setCurrentFile(null);
        const key = `done::${filename}`;
        if (!seen.has(key)) { seen.add(key); setProgress(prev => [...prev, { filename, chunkCount, ok: true }]); loadDocs(); }
      });

      es.addEventListener("file_error", (e) => {
        const { filename, error } = JSON.parse(e.data);
        setCurrentFile(null);
        const key = `err::${filename}`;
        if (!seen.has(key)) { seen.add(key); setProgress(prev => [...prev, { filename, error, ok: false }]); }
      });

      es.addEventListener("done", () => {
        es.close();
        setBatchRunning(false);
        setBatchDone(true);
        setCurrentFile(null);
        setBatchFile(null);
        if (batchInputRef.current) batchInputRef.current.value = "";
        loadDocs();
      });

      es.onerror = () => {
        es.close();
        setCurrentFile(null);
        if (reconnects < MAX_RECONNECTS) {
          reconnects++;
          setTimeout(connectSSE, 3_000); // silent reconnect — job still running on server
        } else {
          setBatchRunning(false);
          setError("Connection lost after multiple retries. Check the Documents tab for partial results.");
        }
      };
    }

    connectSSE();
  }

  // ── Expand / preview ────────────────────────────────────────────────────────

  async function toggleExpand(doc: KBDocument) {
    const next = new Set(expanded);
    if (next.has(doc.id)) {
      next.delete(doc.id);
    } else {
      next.add(doc.id);
      if (!docImages[doc.id]) {
        try {
          const res = await fetch(`/api/knowledge-base/documents/${doc.id}/images`, { credentials: "include" });
          if (res.ok) {
            const { images } = await res.json();
            setDocImages(prev => ({ ...prev, [doc.id]: images }));
          }
        } catch {}
      }
    }
    setExpanded(next);
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  function initUpdate(docId: string) {
    setUpdating(prev => ({ ...prev, [docId]: { file: null, uploading: false, error: "", success: "" } }));
    // Trigger file picker
    setTimeout(() => updateInputRefs.current[docId]?.click(), 50);
  }

  async function doUpdate(doc: KBDocument) {
    const state = updating[doc.id];
    if (!state?.file) return;
    setUpdating(prev => ({ ...prev, [doc.id]: { ...prev[doc.id], uploading: true, error: "", success: "" } }));
    try {
      const form = new FormData();
      form.append("file", state.file);
      const res = await fetch(`/api/knowledge-base/documents/${doc.id}/update`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Update failed"); }
      setUpdating(prev => ({ ...prev, [doc.id]: { file: null, uploading: false, error: "", success: "Updated successfully." } }));
      // Clear preview images so they reload on next expand
      setDocImages(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
      loadDocs();
    } catch (e) {
      setUpdating(prev => ({ ...prev, [doc.id]: { ...prev[doc.id], uploading: false, error: e instanceof Error ? e.message : "Update failed" } }));
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function doDelete(doc: KBDocument) {
    if (!confirm(`Remove "${doc.filename}" from the knowledge base?`)) return;
    setDeleting(doc.id);
    try {
      await fetch(`/api/knowledge-base/documents/${doc.id}`, { method: "DELETE", credentials: "include" });
      setDocs(d => d.filter(x => x.id !== doc.id));
    } catch { setError("Failed to delete document"); }
    finally { setDeleting(null); }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modalOverlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="modalBackdrop" onClick={batchRunning ? undefined : onClose} />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.2 }}
            className="presModalWrap"
          >
            <div className="presModal">
              <button className="presCloseBtn" onClick={batchRunning ? undefined : onClose} title={batchRunning ? "Ingestion in progress…" : "Close"} style={batchRunning ? { opacity: 0.3, cursor: "not-allowed" } : {}}><X className="h-5 w-5" /></button>
              <div className="presModalHeader">
                <div className="presModalTitle">Knowledge base</div>
                <div className="presModalSubtitle">Upload PDF, Markdown, or DOCX documents</div>
              </div>

              <div className="kbTabs">
                <button className={cn("kbTab", tab === "add" && "kbTabActive")} onClick={() => { setTab("add"); clearTab(); }}>Add document</button>
                <button className={cn("kbTab", tab === "batch" && "kbTabActive")} onClick={() => { setTab("batch"); clearTab(); }}>Batch processing</button>
                <button className={cn("kbTab", tab === "docs" && "kbTabActive")} onClick={() => { setTab("docs"); clearTab(); loadDocs(); }}>
                  Documents{docs.length > 0 ? ` (${docs.length})` : ""}
                </button>
                <button className={cn("kbTab", tab === "manage" && "kbTabActive")} onClick={() => { setTab("manage"); clearTab(); setResetConfirm(false); }}>Management</button>
              </div>

              {/* ── Single file ── */}
              {tab === "add" && (
                <>
                  <div className="presForm" style={{ marginTop: 16 }}>
                    <div className="presFieldRow">
                      <div className="presFieldLabel">
                        Document <span style={{ color: "#ef4444", fontWeight: 700 }}>*</span>
                        <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>PDF · MD · DOCX</span>
                      </div>
                      <div className="presFileUpload">
                        <label className="presFileBtn">
                          Choose file
                          <input type="file" accept={ACCEPT} className="presFileInput" onChange={e => {
                            const f = e.target.files?.[0] ?? null;
                            setFile(f);
                            if (f) setDocumentDate(new Date(f.lastModified).toISOString().slice(0, 10));
                            setError(""); setSuccess("");
                          }} />
                        </label>
                        <span className="presFileName">{file ? file.name : "No file chosen"}</span>
                      </div>
                    </div>
                    <div className="presFieldRow">
                      <div className="presFieldLabel">Document date <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 12 }}>(optional)</span></div>
                      <input className="presFieldInput" type="date" value={documentDate} onChange={e => setDocumentDate(e.target.value)} />
                    </div>
                    {error && <div className="authError" style={{ marginTop: 8 }}>{error}</div>}
                    {success && <div style={{ fontSize: 13, color: "#16a34a", marginTop: 8 }}>{success}</div>}
                    {uploading && <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>Ingesting document — extracting text, enriching chunks and building graph… this may take a minute.</div>}
                  </div>
                  <div className="presFooter">
                    <button className="presCancelBtn" onClick={onClose}>Cancel</button>
                    <button className="presSubmitBtn" disabled={!file || uploading} onClick={doUpload}>
                      {uploading ? "Processing…" : "Upload & ingest"}
                    </button>
                  </div>
                </>
              )}

              {/* ── Batch ── */}
              {tab === "batch" && (
                <>
                  <div className="presForm" style={{ marginTop: 16 }}>
                    <div className="presFieldRow">
                      <div className="presFieldLabel">
                        ZIP archive <span style={{ color: "#ef4444", fontWeight: 700 }}>*</span>
                        <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>Contains PDF · MD · DOCX files</span>
                      </div>
                      <div className="presFileUpload">
                        <label className="presFileBtn">
                          Choose ZIP
                          <input
                            ref={batchInputRef}
                            type="file"
                            accept=".zip"
                            className="presFileInput"
                            onChange={e => {
                              setBatchFile(e.target.files?.[0] ?? null);
                              setProgress([]); setCurrentFile(null); setError("");
                            }}
                          />
                        </label>
                        <span className="presFileName">{batchFile ? batchFile.name : "No file chosen"}</span>
                      </div>
                    </div>

                    {error && <div className="authError" style={{ marginTop: 8 }}>{error}</div>}

                    {/* Progress log */}
                    {(batchRunning || progress.length > 0) && (
                      <div
                        ref={progressRef}
                        style={{ marginTop: 12, maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3,
                          background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px" }}
                      >
                        {progress.map((p, i) => (
                          <div key={i} style={{ fontSize: 13, color: p.ok ? "#16a34a" : "#dc2626", fontFamily: "monospace" }}>
                            {p.ok ? `✓ ${p.filename}  (${p.chunkCount} chunks)` : `✗ ${p.filename}: ${p.error}`}
                          </div>
                        ))}
                        {currentFile && (
                          <div style={{ fontSize: 13, color: "#6b7280", fontFamily: "monospace" }}>
                            ⚙ {currentFile}…
                          </div>
                        )}
                        {batchDone && (
                          <div style={{ fontSize: 13, color: "#6b7280", fontFamily: "monospace", marginTop: 4 }}>
                            Done.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="presFooter">
                    {batchRunning && (
                      <span style={{ fontSize: 12, color: "#9ca3af", alignSelf: "center" }}>Ingestion running — do not close</span>
                    )}
                    <button className="presCancelBtn" onClick={() => {
                      if (batchRunning && !confirm("Ingestion is still running on the server. Close and lose progress tracking?")) return;
                      onClose();
                    }}>Cancel</button>
                    <button className="presSubmitBtn" disabled={!batchFile || batchRunning} onClick={doBatch}>
                      {batchRunning ? "Processing…" : "Ingest ZIP"}
                    </button>
                  </div>
                </>
              )}

              {/* ── Document list (folder tree) ── */}
              {tab === "docs" && (() => {
                const tree = buildTree(docs);
                return (
                  <>
                    <div className="presForm" style={{ maxHeight: 420, overflowY: "auto", marginTop: 16 }}>
                      {docs.length === 0 ? (
                        <div style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>No documents yet.</div>
                      ) : [...tree.entries()].map(([folder, folderDocs]) => (
                        <div key={folder || "__root__"} style={{ marginBottom: 8 }}>
                          {/* Folder header (only shown if there is a folder) */}
                          {folder && (
                            <button
                              onClick={() => setOpenFolders(prev => { const n = new Set(prev); n.has(folder) ? n.delete(folder) : n.add(folder); return n; })}
                              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}
                            >
                              {openFolders.has(folder) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span style={{ fontFamily: "monospace" }}>📁 {folder}</span>
                              <span style={{ marginLeft: "auto", fontWeight: 400, color: "#9ca3af" }}>{folderDocs.length} file{folderDocs.length !== 1 ? "s" : ""}</span>
                            </button>
                          )}

                          {/* Docs in this folder — always visible for root, toggled for named folders */}
                          {(!folder || openFolders.has(folder)) && folderDocs.map(doc => {
                            const isExpanded  = expanded.has(doc.id);
                            const images      = docImages[doc.id] ?? [];
                            const upd         = updating[doc.id];
                            return (
                              <div key={doc.id} style={{ marginLeft: folder ? 16 : 0, marginBottom: 6, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                                {/* Doc row */}
                                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#f9fafb", cursor: "pointer" }}
                                  onClick={() => toggleExpand(doc)}>
                                  <span style={{ color: "#9ca3af", flexShrink: 0 }}>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.filename}</span>
                                  <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>{doc.chunkCount} chunks · {doc.lang.toUpperCase()}{doc.documentDate ? ` · ${doc.documentDate}` : ""}</span>
                                  {/* Hidden file input for update */}
                                  <input type="file" accept={ACCEPT} style={{ display: "none" }}
                                    ref={el => { updateInputRefs.current[doc.id] = el; }}
                                    onChange={e => {
                                      const f = e.target.files?.[0] ?? null;
                                      if (f) setUpdating(prev => ({ ...prev, [doc.id]: { file: f, uploading: false, error: "", success: "" } }));
                                      e.target.value = "";
                                    }}
                                  />
                                  <button onClick={e => { e.stopPropagation(); initUpdate(doc.id); }} title="Upload new version"
                                    style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "#9ca3af", flexShrink: 0 }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "#2563eb")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "#9ca3af")}>
                                    <RefreshCw size={14} />
                                  </button>
                                  <button onClick={e => { e.stopPropagation(); doDelete(doc); }} disabled={deleting === doc.id} title="Remove"
                                    style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "#9ca3af", flexShrink: 0 }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "#9ca3af")}>
                                    <Trash2 size={14} />
                                  </button>
                                </div>

                                {/* Expanded preview */}
                                {isExpanded && (
                                  <div style={{ padding: "10px 14px", background: "#fff", borderTop: "1px solid #e5e7eb" }}>
                                    {doc.summary && (
                                      <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5, margin: "0 0 10px" }}>{doc.summary}</p>
                                    )}
                                    {images.length > 0 && (
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                        {images.slice(0, 4).map(url => (
                                          <img key={url} src={url} alt=""
                                            style={{ height: 80, width: "auto", borderRadius: 6, border: "1px solid #e5e7eb", cursor: "zoom-in", objectFit: "contain", background: "#f9fafb" }}
                                            onClick={() => window.open(url, "_blank")}
                                          />
                                        ))}
                                        {images.length > 4 && <span style={{ fontSize: 12, color: "#9ca3af", alignSelf: "center" }}>+{images.length - 4} more</span>}
                                      </div>
                                    )}
                                    {/* Pending update */}
                                    {upd?.file && (
                                      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontSize: 12, color: "#374151" }}>Replace with: <strong>{upd.file.name}</strong></span>
                                        <button className="presSubmitBtn" style={{ padding: "4px 12px", fontSize: 12 }}
                                          onClick={() => doUpdate(doc)} disabled={upd.uploading}>
                                          {upd.uploading ? "Updating…" : "Confirm update"}
                                        </button>
                                        <button className="presCancelBtn" style={{ padding: "4px 10px", fontSize: 12 }}
                                          onClick={() => setUpdating(prev => { const n = { ...prev }; delete n[doc.id]; return n; })}>
                                          Cancel
                                        </button>
                                      </div>
                                    )}
                                    {upd?.error   && <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>{upd.error}</div>}
                                    {upd?.success && <div style={{ marginTop: 6, fontSize: 12, color: "#16a34a" }}>{upd.success}</div>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <div className="presFooter">
                      <button className="presCancelBtn" onClick={onClose}>Close</button>
                    </div>
                  </>
                );
              })()}

              {/* ── Management ── */}
              {tab === "manage" && (
                <>
                  <div className="presForm" style={{ marginTop: 16 }}>
                    {!resetConfirm ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ fontSize: 14, color: "#374151" }}>
                          Reset will permanently delete all documents and their chunks from the knowledge base.
                        </div>
                        <button className="presSubmitBtn" style={{ alignSelf: "flex-start" }}
                          onClick={() => setResetConfirm(true)}>
                          Reset knowledge base
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#dc2626" }}>
                          Do you really want to reset the knowledge base? All documents will be lost!
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <button className="presSubmitBtn" disabled={resetting} onClick={doReset}>
                            {resetting ? "Resetting…" : "Yes, delete all"}
                          </button>
                          <button className="presCancelBtn" onClick={() => setResetConfirm(false)}>No, cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="presFooter">
                    <button className="presCancelBtn" onClick={onClose}>Close</button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
