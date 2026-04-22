import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, XCircle, ShieldCheck, BookOpen } from "lucide-react";

interface PendingUser {
  id: string;
  email: string;
  name: string;
  provider: string;
  created_at: string;
}

export function ValidationDialog({
  open,
  onClose,
  onCountChange,
}: {
  open: boolean;
  onClose: () => void;
  onCountChange: (n: number) => void;
}) {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/users/pending", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
        onCountChange(data.length);
      }
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { if (open) load(); }, [open]);

  async function approveAsContributor(user: PendingUser) {
    setProcessing(user.id);
    try {
      await fetch(`/api/users/${user.id}/approve`, { method: "POST", credentials: "include" });
      await fetch(`/api/users/${user.id}/role`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "contributor" }),
      });
      const updated = users.filter((u) => u.id !== user.id);
      setUsers(updated);
      onCountChange(updated.length);
    } catch {}
    finally { setProcessing(null); }
  }

  async function approveAsAdmin(user: PendingUser) {
    setProcessing(user.id);
    try {
      await fetch(`/api/users/${user.id}/approve`, { method: "POST", credentials: "include" });
      await fetch(`/api/users/${user.id}/role`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });
      const updated = users.filter((u) => u.id !== user.id);
      setUsers(updated);
      onCountChange(updated.length);
    } catch {}
    finally { setProcessing(null); }
  }

  async function approve(user: PendingUser) {
    setProcessing(user.id);
    try {
      await fetch(`/api/users/${user.id}/approve`, { method: "POST", credentials: "include" });
      const updated = users.filter((u) => u.id !== user.id);
      setUsers(updated);
      onCountChange(updated.length);
    } catch {}
    finally { setProcessing(null); }
  }

  async function reject(user: PendingUser) {
    setProcessing(user.id);
    try {
      await fetch(`/api/users/${user.id}/reject`, { method: "POST", credentials: "include" });
      const updated = users.filter((u) => u.id !== user.id);
      setUsers(updated);
      onCountChange(updated.length);
    } catch {}
    finally { setProcessing(null); }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modalOverlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="modalBackdrop" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.2 }}
            className="presModalWrap"
          >
            <div className="presModal">
              <button className="presCloseBtn" onClick={onClose}><X className="h-5 w-5" /></button>
              <div className="presModalHeader">
                <div className="presModalTitle">Validate users</div>
                <div className="presModalSubtitle">
                  {users.length === 0 ? "No pending requests." : `${users.length} request${users.length > 1 ? "s" : ""} awaiting approval`}
                </div>
              </div>

              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
                {loading && <div style={{ fontSize: 14, color: "#9ca3af", padding: "12px 0" }}>Loading…</div>}

                {!loading && users.length === 0 && (
                  <div style={{ fontSize: 14, color: "#9ca3af", fontStyle: "italic", padding: "12px 0" }}>
                    All access requests have been processed.
                  </div>
                )}

                {users.map((user) => (
                  <div key={user.id} className="validationRow">
                    <div className="validationInfo">
                      <div className="validationName">{user.name || "—"}</div>
                      <div className="validationEmail">{user.email}</div>
                      <div className="validationMeta">
                        {user.provider} · {new Date(user.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="validationActions">
                      <button
                        className="validationBtn validationBtnGrant"
                        disabled={processing === user.id}
                        onClick={() => approve(user)}
                        title="Grant access"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Grant
                      </button>
                      <button
                        className="validationBtn validationBtnGrant"
                        style={{ opacity: 0.8 }}
                        disabled={processing === user.id}
                        onClick={() => approveAsContributor(user)}
                        title="Grant access as contributor (knowledge base management)"
                      >
                        <BookOpen className="h-4 w-4" />
                        Contrib
                      </button>
                      <button
                        className="validationBtn validationBtnGrant"
                        style={{ opacity: 0.8 }}
                        disabled={processing === user.id}
                        onClick={() => approveAsAdmin(user)}
                        title="Grant access as admin"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        Admin
                      </button>
                      <button
                        className="validationBtn validationBtnDeny"
                        disabled={processing === user.id}
                        onClick={() => reject(user)}
                        title="Deny access"
                      >
                        <XCircle className="h-4 w-4" />
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="presFooter" style={{ marginTop: 24 }}>
                <button className="presCancelBtn" onClick={onClose}>Close</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
