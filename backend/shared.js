/**
 * shared.js — shared state, SQLite DB, session helpers, and middleware.
 * Imported by all route modules to avoid circular deps.
 */
import "dotenv/config";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config ────────────────────────────────────────────────────────────────────
export const UPLOADS_DIR      = process.env.UPLOADS_DIR      || path.join(__dirname, "../uploads");
export const DB_PATH          = process.env.DB_PATH           || path.join(__dirname, "users.db");
export const ADMIN_SEED_EMAIL = process.env.ADMIN_SEED_EMAIL  || "admin@example.com";
export const PORT             = process.env.PORT              || 3001;
export const FRONTEND_ORIGIN  = process.env.FRONTEND_ORIGIN   || "http://localhost:5173";
export const APP_BASE_URL     = process.env.APP_BASE_URL      || FRONTEND_ORIGIN;
export const COOKIE_NAME      = process.env.COOKIE_NAME       || "gd_session";
export const COOKIE_SECURE    = String(process.env.COOKIE_SECURE || "false") === "true";
export const COOKIE_SAMESITE  = process.env.COOKIE_SAMESITE   || "lax";
export const BCRYPT_ROUNDS    = 10;
export const VERIFY_TTL_MS    = 30 * 60 * 1000;

// ── Database ──────────────────────────────────────────────────────────────────
export const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    name           TEXT,
    picture        TEXT,
    role           TEXT NOT NULL DEFAULT 'user',
    provider       TEXT NOT NULL DEFAULT 'email',
    password_hash  TEXT,
    verified       INTEGER NOT NULL DEFAULT 0,
    verify_token   TEXT,
    verify_expires TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    last_login     TEXT
  )
`);

for (const col of [
  "ALTER TABLE users ADD COLUMN provider      TEXT NOT NULL DEFAULT 'email'",
  "ALTER TABLE users ADD COLUMN password_hash TEXT",
  "ALTER TABLE users ADD COLUMN verified      INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN verify_token  TEXT",
  "ALTER TABLE users ADD COLUMN verify_expires TEXT",
  "ALTER TABLE users ADD COLUMN status        TEXT NOT NULL DEFAULT 'approved'",
]) {
  try { db.exec(col); } catch { /* column already exists */ }
}

db.exec("UPDATE users SET status='approved' WHERE provider IN ('google','seed') AND status != 'approved'");
db.exec("UPDATE users SET verified = 1 WHERE provider = 'google' AND verified = 0");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chats (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New chat',
    lang       TEXT NOT NULL DEFAULT 'en',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    text       TEXT NOT NULL,
    images     TEXT NOT NULL DEFAULT '[]',
    timestamp  TEXT DEFAULT (datetime('now'))
  );
`);

for (const col of [
  "ALTER TABLE chats    ADD COLUMN lang   TEXT NOT NULL DEFAULT 'en'",
  "ALTER TABLE messages ADD COLUMN images TEXT NOT NULL DEFAULT '[]'",
]) {
  try { db.exec(col); } catch { /* column already exists */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id            TEXT PRIMARY KEY,
    filename      TEXT NOT NULL,
    filepath      TEXT NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT '',
    language      TEXT NOT NULL DEFAULT 'en',
    summary       TEXT NOT NULL DEFAULT '',
    uploaded_at   TEXT NOT NULL,
    word_count    INTEGER NOT NULL DEFAULT 0,
    document_date TEXT,
    s3_key        TEXT,
    images        TEXT NOT NULL DEFAULT '[]'
  )
`);

db.prepare(`
  INSERT INTO users (id, email, name, role, provider, verified)
  VALUES (?, ?, 'Administrator', 'admin', 'seed', 1)
  ON CONFLICT(email) DO UPDATE SET role = 'admin' WHERE role = 'user'
`).run("seed-" + ADMIN_SEED_EMAIL, ADMIN_SEED_EMAIL);

// ── Prepared statements ───────────────────────────────────────────────────────
export const stmtFindById     = db.prepare("SELECT * FROM users WHERE id = ?");
export const stmtFindByEmail  = db.prepare("SELECT * FROM users WHERE email = ?");
export const stmtFindByToken  = db.prepare("SELECT * FROM users WHERE verify_token = ?");
export const stmtAllUsers     = db.prepare("SELECT id, email, name, picture, role, provider, verified, status, created_at, last_login FROM users ORDER BY created_at");
export const stmtAllAdmins    = db.prepare("SELECT email, name FROM users WHERE role = 'admin' AND status = 'approved'");
export const stmtUpdateRole   = db.prepare("UPDATE users SET role = ? WHERE id = ?");
export const stmtGoogleUpsert = db.prepare(`
  INSERT INTO users (id, email, name, picture, provider, verified, last_login)
  VALUES (?, ?, ?, ?, 'google', 1, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, picture = excluded.picture, last_login = excluded.last_login
`);
export const stmtLdapUpsert = db.prepare(`
  INSERT INTO users (id, email, name, provider, verified, status, last_login)
  VALUES (?, ?, ?, 'ldap', 1, 'pending', datetime('now'))
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_login = excluded.last_login
`);

// ── Session store ─────────────────────────────────────────────────────────────
export const sessions    = new Map();
export const oauthStates = new Map();
export let googleClient  = null;
export function setGoogleClient(client) { googleClient = client; }

// ── Helpers ───────────────────────────────────────────────────────────────────
export function now()    { return Date.now(); }
export function makeId() { return crypto.randomBytes(24).toString("hex"); }

export function setSessionCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE,
    path: "/", maxAge: 7 * 24 * 3600 * 1000,
  });
}
export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path: "/" });
}
export function getSession(req) {
  const sid = req.cookies?.[COOKIE_NAME];
  return sid ? (sessions.get(sid) || null) : null;
}
export function createSession(res, user) {
  const sid = makeId();
  sessions.set(sid, { user, createdAt: now() });
  setSessionCookie(res, sid);
}
export function dbUserToSession(dbUser) {
  return { id: dbUser.id, name: dbUser.name, email: dbUser.email, picture: dbUser.picture, role: dbUser.role, provider: dbUser.provider };
}

// ── Middleware ────────────────────────────────────────────────────────────────
export function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.sendStatus(401);
  req.session = session;
  next();
}
export function requireAdmin(req, res, next) {
  if (req.session?.user?.role !== "admin") return res.sendStatus(403);
  next();
}
export function requireContributor(req, res, next) {
  const role = req.session?.user?.role;
  if (role !== "admin" && role !== "contributor") return res.sendStatus(403);
  next();
}
