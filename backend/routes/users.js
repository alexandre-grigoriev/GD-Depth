/**
 * routes/users.js — user management (admin only)
 */
import express from "express";
import { db, sessions, stmtAllUsers, stmtUpdateRole, requireAuth, requireAdmin, requireContributor } from "../shared.js";
import { sendApprovalEmail, sendRejectionEmail } from "../email.js";

export const router = express.Router();

router.get("/api/users", requireAuth, requireAdmin, (req, res) => {
  res.json(stmtAllUsers.all());
});

router.put("/api/users/:id/role", requireAuth, requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!["admin", "contributor", "user"].includes(role))
    return res.status(400).json({ error: "Invalid role. Must be admin | contributor | user" });
  const info = stmtUpdateRole.run(role, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "User not found" });
  for (const [, session] of sessions)
    if (session.user.id === req.params.id) session.user.role = role;
  res.json({ ok: true });
});

// ── Validation ────────────────────────────────────────────────────────────────

/** List users pending admin approval */
router.get("/api/users/pending", requireAuth, requireAdmin, (req, res) => {
  const pending = db.prepare(
    "SELECT id, email, name, provider, created_at FROM users WHERE status='pending' ORDER BY created_at"
  ).all();
  res.json(pending);
});

/** Approve a user */
router.post("/api/users/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  db.prepare("UPDATE users SET status='approved' WHERE id=?").run(req.params.id);
  await sendApprovalEmail(user.email, user.name);
  res.json({ ok: true });
});

/** Reject and delete a user */
router.post("/api/users/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  await sendRejectionEmail(user.email, user.name);
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
