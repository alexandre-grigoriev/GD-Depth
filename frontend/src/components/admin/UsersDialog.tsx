import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

type Role = "admin" | "contributor" | "user";

interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  provider: string;
  status: string;
  created_at: string;
  last_login: string | null;
}

const ROLE_LABELS: Record<Role, string> = {
  admin:       "Admin",
  contributor: "Contributor",
  user:        "User",
};

const ROLE_COLOR: Record<Role, string> = {
  admin:       "#1677ff",
  contributor: "#7c3aed",
  user:        "#374151",
};

export function UsersDialog({
  open,
  onClose,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
}) {
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState<string | null>(null);
  const [saved, setSaved]       = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { credentials: "include" });
      if (res.ok) setUsers(await res.json());
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { if (open) load(); }, [open]);

  async function changeRole(user: User, role: Role) {
    if (role === user.role) return;
    setSaving(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/role`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role } : u));
        setSaved(user.id);
        setTimeout(() => setSaved(null), 1500);
      }
    } catch {}
    finally { setSaving(null); }
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
            <div className="presModal" style={{ minWidth: 640, maxWidth: 820 }}>
              <button className="presCloseBtn" onClick={onClose}><X className="h-5 w-5" /></button>
              <div className="presModalHeader">
                <div className="presModalTitle">Users</div>
                <div className="presModalSubtitle">
                  {loading ? "Loading…" : `${users.length} account${users.length !== 1 ? "s" : ""}`}
                </div>
              </div>

              <div style={{ marginTop: 20, maxHeight: 480, overflowY: "auto" }}>
                {loading && (
                  <div style={{ fontSize: 14, color: "#9ca3af", padding: "12px 0" }}>Loading…</div>
                )}
                {!loading && users.length === 0 && (
                  <div style={{ fontSize: 14, color: "#9ca3af", fontStyle: "italic", padding: "12px 0" }}>No users found.</div>
                )}
                {!loading && users.length > 0 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                        {["Name", "Email", "Provider", "Status", "Role", "Last login"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "#6b7280", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => {
                        const isSelf = user.id === currentUserId;
                        const isFlashing = saved === user.id;
                        return (
                          <tr
                            key={user.id}
                            style={{
                              borderBottom: "1px solid var(--border, #f3f4f6)",
                              background: isFlashing ? "#f0fdf4" : undefined,
                              transition: "background 0.4s",
                              opacity: user.status === "rejected" ? 0.45 : 1,
                            }}
                          >
                            <td style={{ padding: "8px 10px", fontWeight: 500, whiteSpace: "nowrap" }}>
                              {user.name || "—"}
                              {isSelf && <span style={{ marginLeft: 6, fontSize: 11, color: "#9ca3af" }}>(you)</span>}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#6b7280", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {user.email}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#6b7280" }}>
                              {user.provider}
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 99,
                                background: user.status === "approved" ? "#dcfce7" : user.status === "pending" ? "#fef9c3" : "#fee2e2",
                                color:      user.status === "approved" ? "#15803d" : user.status === "pending" ? "#92400e" : "#b91c1c",
                              }}>
                                {user.status ?? "approved"}
                              </span>
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              {isSelf ? (
                                <span style={{ fontWeight: 600, color: ROLE_COLOR[user.role] }}>
                                  {ROLE_LABELS[user.role]}
                                </span>
                              ) : (
                                <select
                                  value={user.role}
                                  disabled={saving === user.id}
                                  onChange={e => changeRole(user, e.target.value as Role)}
                                  style={{
                                    fontSize: 12, fontWeight: 600,
                                    color: ROLE_COLOR[user.role],
                                    border: "1px solid var(--border, #e5e7eb)",
                                    borderRadius: 6, padding: "3px 6px",
                                    background: "var(--surface, #fff)",
                                    cursor: "pointer",
                                    opacity: saving === user.id ? 0.5 : 1,
                                  }}
                                >
                                  <option value="user">User</option>
                                  <option value="contributor">Contributor</option>
                                  <option value="admin">Admin</option>
                                </select>
                              )}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#9ca3af", whiteSpace: "nowrap" }}>
                              {user.last_login
                                ? new Date(user.last_login).toLocaleDateString()
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
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
