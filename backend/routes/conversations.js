/**
 * conversations.js — projects / chats / messages CRUD
 */
import { Router } from "express";
import { db, requireAuth, makeId } from "../shared.js";

export const router = Router();

// ── Projects ──────────────────────────────────────────────────────────────────

/** List all projects (with their chats) for the authenticated user */
router.get("/api/projects", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const projects = db.prepare(
    "SELECT id, name, created_at FROM projects WHERE user_id = ? ORDER BY created_at"
  ).all(userId);
  const result = projects.map((p) => ({
    ...p,
    chats: db.prepare(
      "SELECT id, title, lang, created_at FROM chats WHERE project_id = ? ORDER BY created_at"
    ).all(p.id),
  }));
  res.json(result);
});

/** Create a project */
router.post("/api/projects", requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });
  const id = makeId();
  db.prepare("INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)")
    .run(id, req.session.user.id, name.trim());
  res.json({ id, name: name.trim(), created_at: new Date().toISOString(), chats: [] });
});

/** Rename a project */
router.patch("/api/projects/:id", requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });
  db.prepare("UPDATE projects SET name = ? WHERE id = ? AND user_id = ?")
    .run(name.trim(), req.params.id, req.session.user.id);
  res.json({ ok: true });
});

/** Delete a project (cascades to chats and messages) */
router.delete("/api/projects/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.session.user.id);
  res.json({ ok: true });
});

// ── Chats ─────────────────────────────────────────────────────────────────────

/** Create a chat inside a project */
router.post("/api/projects/:projectId/chats", requireAuth, (req, res) => {
  const project = db.prepare(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?"
  ).get(req.params.projectId, req.session.user.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const { title = "New chat" } = req.body;
  const id = makeId();
  db.prepare("INSERT INTO chats (id, project_id, title) VALUES (?, ?, ?)")
    .run(id, req.params.projectId, title);
  res.json({ id, title, created_at: new Date().toISOString() });
});

/** Update chat title and/or lang */
router.patch("/api/chats/:id", requireAuth, (req, res) => {
  const { title, lang } = req.body;
  if (title?.trim()) {
    db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(title.trim(), req.params.id);
  }
  if (lang) {
    db.prepare("UPDATE chats SET lang = ? WHERE id = ?").run(lang, req.params.id);
  }
  res.json({ ok: true });
});

/** Delete a chat (cascades to messages) */
router.delete("/api/chats/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM chats WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── Messages ──────────────────────────────────────────────────────────────────

/** Get all messages for a chat */
router.get("/api/chats/:id/messages", requireAuth, (req, res) => {
  const messages = db.prepare(
    "SELECT id, role, text, timestamp, images FROM messages WHERE chat_id = ? ORDER BY timestamp"
  ).all(req.params.id);
  res.json(messages.map(m => ({
    ...m,
    images: JSON.parse(m.images || "[]"),
  })));
});

/** Append a message to a chat */
router.post("/api/chats/:id/messages", requireAuth, (req, res) => {
  const { id, role, text, timestamp, images } = req.body;
  if (!role || !text) return res.status(400).json({ error: "role and text required" });
  const msgId = id || makeId();
  db.prepare(
    "INSERT INTO messages (id, chat_id, role, text, timestamp, images) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(msgId, req.params.id, role, text, timestamp || new Date().toISOString(), JSON.stringify(images ?? []));
  res.json({ ok: true, id: msgId });
});
