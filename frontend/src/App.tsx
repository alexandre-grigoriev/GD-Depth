import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, LogOut, CheckCircle2, Plus, Trash2, MessageSquare, FolderOpen, Pencil, Users } from "lucide-react";
import "./App.css";
import { LANGS, CONTEXT_LIMIT_TOKENS } from "./constants";
import { cn, UserStatusIcon } from "./utils";
import { TopSelect } from "./components/ui/TopSelect";
import { AuthDialog } from "./components/auth/AuthDialog";
import { AddPdfDialog } from "./components/knowledge-base/AddPdfDialog";
import { ValidationDialog } from "./components/admin/ValidationDialog";
import { UsersDialog } from "./components/admin/UsersDialog";
import { ChatPanel } from "./components/chat/ChatPanel";
import { sendToGemini, estimateTokens, type ChatMessage as GeminiMessage } from "./services/gemini";
import type { ProjectSummary, ChatMessage } from "./types";

function makeId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function now()    { return new Date().toISOString(); }

export default function App() {
  const [user, setUser] = useState<null | {
    id: string; name: string; email: string; picture?: string;
    role: "admin" | "contributor" | "user"; provider: string;
  }>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [verifiedBanner, setVerifiedBanner] = useState(false);
  const [pendingBanner, setPendingBanner] = useState(false);

  const [lang, setLang] = useState("fr");
  const [addPdfOpen, setAddPdfOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>({});
  const [isThinking, setIsThinking] = useState(false);
  const [input, setInput] = useState("");

  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Resizable splitter
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.round(window.innerWidth * 0.25));
  const isDragging = useRef(false);
  const mainGridRef = useRef<HTMLElement>(null);

  // ── API helpers ──────────────────────────────────────────────────────────────

  async function loadProjects() {
    try {
      const res = await fetch("/api/projects", { credentials: "include" });
      if (res.ok) setProjects(await res.json());
    } catch {}
  }

  async function loadMessages(chatId: string) {
    if (chatMessages[chatId]) return; // already loaded
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, { credentials: "include" });
      if (res.ok) { const msgs = await res.json(); setChatMessages((prev) => ({ ...prev, [chatId]: msgs })); }
    } catch {}
  }

  async function saveMessage(chatId: string, msg: ChatMessage) {
    try {
      await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });
    } catch {}
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
      setVerifiedBanner(true);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setVerifiedBanner(false), 6000);
    }
    if (params.get("pending") === "1") {
      setPendingBanner(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (cancelled) return;
        if (res.ok) {
          const u = await res.json();
          setUser(u);
          setAuthOpen(false);
        } else {
          setUser(null); setAuthOpen(true);
        }
      } catch {
        if (!cancelled) { setUser(null); setAuthOpen(true); }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load projects + pending count when user is set
  useEffect(() => {
    if (user) {
      loadProjects();
      if (user.role === "admin") {
        fetch("/api/users/pending", { credentials: "include" })
          .then((r) => r.ok ? r.json() : [])
          .then((data) => setPendingCount(Array.isArray(data) ? data.length : 0))
          .catch(() => {});
      }
    } else {
      setProjects([]);
      setPendingCount(0);
    }
  }, [user]);

  // Restore language when chat is activated.
  // Depends on both activeChatId AND projects — projects load async after mount.
  const activeChatIdRef = useRef<string | null>(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    if (!activeChatId) return;
    loadMessages(activeChatId);
    const chat = projects.flatMap(p => p.chats).find(c => c.id === activeChatId);
    if (chat?.lang) setLang(chat.lang);
  }, [activeChatId, projects]);

  // Persist language to the active chat on every change:
  // - user moves the dropdown
  // - chat switch restores a different lang (idempotent — same value already saved)
  // - lang changed while chat is empty
  const isFirstLangRender = useRef(true);
  useEffect(() => {
    if (isFirstLangRender.current) { isFirstLangRender.current = false; return; }
    const chatId = activeChatIdRef.current;
    if (!chatId) return;
    // Keep local projects state in sync so the restore effect never reads a stale lang
    // (e.g. first-message auto-title triggers setProjects and re-runs restore).
    setProjects(prev => prev.map(p => ({
      ...p, chats: p.chats.map(c => c.id === chatId ? { ...c, lang } : c),
    })));
    fetch(`/api/chats/${chatId}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang }),
    }).catch(() => {});
  }, [lang]);

  // Close user menu on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!userMenuOpen) return;
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [userMenuOpen]);

  // Splitter drag
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current || !mainGridRef.current) return;
      const rect = mainGridRef.current.getBoundingClientRect();
      setSidebarWidth(Math.max(220, Math.min(600, e.clientX - rect.left)));
    }
    function onUp() {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  // ── Project / chat management ─────────────────────────────────────────────────

  async function createProject() {
    const name = newProjectName.trim() || "New project";
    try {
      const res = await fetch("/api/projects", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const project = await res.json();
        setProjects((prev) => [...prev, project]);
        setActiveProjectId(project.id);
        setActiveChatId(null);
      }
    } catch {}
    setNewProjectName("");
    setCreatingProject(false);
  }

  async function deleteProject(id: string) {
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE", credentials: "include" });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProjectId === id) { setActiveProjectId(null); setActiveChatId(null); }
    } catch {}
  }

  async function createChat(projectId: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/chats`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      if (res.ok) {
        const chat = await res.json();
        // Immediately persist the current UI language so restoring this chat
        // later always returns to the correct language (not the DB default 'fr').
        fetch(`/api/chats/${chat.id}`, {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang }),
        }).catch(() => {});
        setProjects((prev) => prev.map((p) =>
          p.id === projectId ? { ...p, chats: [...p.chats, { ...chat, lang }] } : p
        ));
        setActiveProjectId(projectId);
        setActiveChatId(chat.id);
        setChatMessages((prev) => ({ ...prev, [chat.id]: [] }));
      }
    } catch {}
  }

  async function renameChat(projectId: string, chatId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, lang }),
      });
      setProjects((prev) => prev.map((p) =>
        p.id === projectId ? { ...p, chats: p.chats.map((c) => c.id === chatId ? { ...c, title: trimmed } : c) } : p
      ));
    } catch {}
    setRenamingChatId(null);
  }

  // F2 shortcut — start renaming the currently active chat
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "F2") return;
      if (!activeChatId || renamingChatId) return;
      // Don't intercept F2 while user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const chat = projects.flatMap(p => p.chats).find(c => c.id === activeChatId);
      if (chat) { setRenamingChatId(activeChatId); setRenameValue(chat.title); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeChatId, renamingChatId, projects]);

  async function deleteChat(projectId: string, chatId: string) {
    try {
      await fetch(`/api/chats/${chatId}`, { method: "DELETE", credentials: "include" });
      setProjects((prev) => prev.map((p) =>
        p.id === projectId ? { ...p, chats: p.chats.filter((c) => c.id !== chatId) } : p
      ));
      setChatMessages((prev) => { const n = { ...prev }; delete n[chatId]; return n; });
      if (activeChatId === chatId) setActiveChatId(null);
    } catch {}
  }

  // ── Message sending ───────────────────────────────────────────────────────────

  const send = useCallback(async (text?: string) => {
    const v = (text ?? input).trim();
    if (!v || isThinking) return;
    setInput("");

    // Auto-create project + chat if none active
    let projId = activeProjectId;
    let chatId = activeChatId;

    if (!projId) {
      try {
        // Reuse existing "Default" project if one already exists
        const existing = projects.find((p) => p.name === "Default");
        if (existing) {
          projId = existing.id;
          setActiveProjectId(projId);
        } else {
          const res = await fetch("/api/projects", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Default" }),
          });
          if (res.ok) {
            const project = await res.json();
            setProjects((prev) => [...prev, project]);
            projId = project.id;
            setActiveProjectId(projId);
          }
        }
      } catch { return; }
    }

    if (!chatId) {
      try {
        const res = await fetch(`/api/projects/${projId}/chats`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: v.slice(0, 40) }),
        });
        if (res.ok) {
          const chat = await res.json();
          setProjects((prev) => prev.map((p) =>
            p.id === projId ? { ...p, chats: [...p.chats, chat] } : p
          ));
          chatId = chat.id;
          setActiveChatId(chatId);
          setChatMessages((prev) => ({ ...prev, [chatId!]: [] }));
        }
      } catch { return; }
    }

    const userMsg: ChatMessage = { id: makeId(), role: "user", text: v, timestamp: now() };
    setChatMessages((prev) => ({ ...prev, [chatId!]: [...(prev[chatId!] ?? []), userMsg] }));
    await saveMessage(chatId!, userMsg);
    setIsThinking(true);

    // Update chat title from first message
    const currentMessages = chatMessages[chatId!] ?? [];
    if (currentMessages.length === 0) {
      const title = v.slice(0, 40);
      fetch(`/api/chats/${chatId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).then(() => {
        setProjects((prev) => prev.map((p) =>
          p.id === projId
            ? { ...p, chats: p.chats.map((c) => c.id === chatId ? { ...c, title } : c) }
            : p
        ));
      }).catch(() => {});
    }

    try {
      const history: GeminiMessage[] = (chatMessages[chatId!] ?? []).map((m) => ({
        role: m.role, text: m.text,
      }));
      const { text: response, images } = await sendToGemini(v, history, lang);
      const botMsg: ChatMessage = { id: makeId(), role: "assistant", text: response, timestamp: now(), images };
      setChatMessages((prev) => ({ ...prev, [chatId!]: [...(prev[chatId!] ?? []), botMsg] }));
      await saveMessage(chatId!, botMsg);
    } catch {
      const errMsg: ChatMessage = { id: makeId(), role: "assistant", text: "Sorry, an error occurred. Please try again.", timestamp: now() };
      setChatMessages((prev) => ({ ...prev, [chatId!]: [...(prev[chatId!] ?? []), errMsg] }));
      await saveMessage(chatId!, errMsg);
    } finally {
      setIsThinking(false);
    }
  }, [input, isThinking, activeProjectId, activeChatId, chatMessages, lang]);

  // ── Derived state ─────────────────────────────────────────────────────────────

  const activeProject  = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeChat     = activeProject?.chats.find((c) => c.id === activeChatId) ?? null;
  const activeMessages = activeChatId ? (chatMessages[activeChatId] ?? []) : [];
  const contextTokens  = estimateTokens(activeMessages, input);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="appRoot">
      <header className="topBar">
        <div className="topBarInner">
          <div className="brandLeft">
            <img className="brandHoriba" src="/screen logo Horiba.png" alt="HORIBA" />
          </div>
          <span className="brandName">Astra Docs</span>

          <div className="topRight" ref={userMenuRef}>
            <TopSelect imgSrc="/language.png" value={lang} options={LANGS} onChange={setLang} />

            <button className="userBtn" onClick={() => {
              const opening = !userMenuOpen;
              setUserMenuOpen(opening);
              if (opening && user?.role === "admin") {
                fetch("/api/users/pending", { credentials: "include" })
                  .then((r) => r.ok ? r.json() : [])
                  .then((data) => setPendingCount(Array.isArray(data) ? data.length : 0))
                  .catch(() => {});
              }
            }} title={user?.email ?? "Sign in"}>
              <span className="userAvatar">
                <UserStatusIcon email={user?.email} className="h-5 w-5" />
              </span>
              <span className="userText">
                <span className="userName">{user?.name ?? "Guest"}</span>
                <span className="userEmail">{user?.email ?? ""}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-gray-600" />
            </button>

            {userMenuOpen && (
              <div className="userMenu">
                <div className="userMenuTop">
                  <div className="font-semibold">{user?.name ?? "Guest"}</div>
                  <div className="text-[13px] text-gray-500">{user?.email ?? "Please sign in"}</div>
                  {user?.role && (
                    <div className="userRoleBadge" data-role={user.role}>
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </div>
                  )}
                </div>
                <div className="userMenuActions">
                  {!user ? (
                    <button className="blueBtn w-full" onClick={() => setAuthOpen(true)}>Sign in</button>
                  ) : (
                    <>
                      {(user.role === "admin" || user.role === "contributor") && (
                        <button className="ghostBtn w-full" style={{ justifyContent: "flex-start" }}
                          onClick={() => { setAddPdfOpen(true); setUserMenuOpen(false); }}>
                          ⊕  Knowledge base…
                        </button>
                      )}
                      {user.role === "admin" && (
                        <>
                          <button
                            className="ghostBtn w-full"
                            style={{ justifyContent: "flex-start", opacity: pendingCount === 0 ? 0.45 : 1 }}
                            disabled={pendingCount === 0}
                            onClick={() => { setValidationOpen(true); setUserMenuOpen(false); }}
                          >
                            ✓  Validation requests
                            {pendingCount > 0 && <span className="validationBadge">{pendingCount}</span>}
                          </button>
                          <button className="ghostBtn w-full" style={{ justifyContent: "flex-start" }}
                            onClick={() => { setUsersOpen(true); setUserMenuOpen(false); }}>
                            <Users className="h-4 w-4" style={{ marginRight: 6 }} />
                            Users
                          </button>
                        </>
                      )}
                      <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "5px 0" }} />
                      <button className="ghostBtn w-full"
                        onClick={async () => {
                          try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch {}
                          setUser(null); setAuthOpen(true); setUserMenuOpen(false);
                          setProjects([]); setActiveProjectId(null); setActiveChatId(null);
                        }}>
                        <LogOut className="h-4 w-4" /> Sign out
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main ref={mainGridRef} className="mainGrid" style={{ gridTemplateColumns: `${sidebarWidth}px auto 1fr` }}>
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebarHeader">
            <span className="sidebarTitle">Projects</span>
            <button className="iconBtn" title="New project" onClick={() => setCreatingProject(true)}>
              <Plus className="h-5 w-5" />
            </button>
          </div>

          {creatingProject && (
            <div className="sidebarNewProject">
              <input
                className="sidebarInput"
                autoFocus
                placeholder="Project name…"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createProject();
                  if (e.key === "Escape") { setCreatingProject(false); setNewProjectName(""); }
                }}
              />
              <div className="sidebarInputActions">
                <button className="blueBtn" style={{ padding: "6px 12px", fontSize: 13 }} onClick={createProject}>Create</button>
                <button className="ghostBtn" style={{ padding: "6px 12px", fontSize: 13 }}
                  onClick={() => { setCreatingProject(false); setNewProjectName(""); }}>Cancel</button>
              </div>
            </div>
          )}

          <div className="sidebarProjects">
            {projects.length === 0 && !creatingProject && (
              <div className="sidebarEmpty">No projects yet.<br />Create one to get started.</div>
            )}
            {projects.map((project) => (
              <div key={project.id} className="projectGroup">
                <div
                  className={cn("projectRow", activeProjectId === project.id && "projectRowActive")}
                  onClick={() => {
                    setActiveProjectId(project.id);
                    if (activeChatId && !project.chats.find((c) => c.id === activeChatId)) setActiveChatId(null);
                  }}
                >
                  <FolderOpen className="h-5 w-5 flex-shrink-0" />
                  <span className="projectName">{project.name}</span>
                  <div className="projectActions">
                    <button className="sidebarIconBtn" title="New chat"
                      onClick={(e) => { e.stopPropagation(); createChat(project.id); }}>
                      <Plus className="h-5 w-5" />
                    </button>
                    <button className="sidebarIconBtn sidebarIconBtnDanger" title="Delete project"
                      onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}>
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {activeProjectId === project.id && project.chats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn("chatRow", activeChatId === chat.id && "chatRowActive")}
                    onClick={() => { if (renamingChatId !== chat.id) { setActiveProjectId(project.id); setActiveChatId(chat.id); } }}
                  >
                    <MessageSquare className="h-5 w-5 flex-shrink-0" />
                    {renamingChatId === chat.id ? (
                      <input
                        className="chatRenameInput"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameChat(project.id, chat.id, renameValue);
                          if (e.key === "Escape") setRenamingChatId(null);
                        }}
                        onBlur={() => renameChat(project.id, chat.id, renameValue)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="chatRowTitle">{chat.title}</span>
                    )}
                    <button className="sidebarIconBtn" title="Rename chat (F2)"
                      onClick={(e) => { e.stopPropagation(); setRenamingChatId(chat.id); setRenameValue(chat.title); }}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button className="sidebarIconBtn sidebarIconBtnDanger" title="Delete chat"
                      onClick={(e) => { e.stopPropagation(); deleteChat(project.id, chat.id); }}>
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Splitter */}
        <div className="splitter" onMouseDown={(e) => {
          e.preventDefault(); isDragging.current = true;
          document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
        }}>
          <div className="splitterLine" />
        </div>

        {/* Chat */}
        <ChatPanel
          chat={activeChat}
          messages={activeMessages}
          lang={lang}
          isThinking={isThinking}
          input={input}
          onInputChange={setInput}
          onSend={send}
          contextTokens={contextTokens}
          contextLimit={CONTEXT_LIMIT_TOKENS}
        />
      </main>

      <div className="footerNote">Astra Docs — HORIBA FRANCE 2026 — Powered by AI</div>

      {addPdfOpen && <AddPdfDialog open={addPdfOpen} onClose={() => setAddPdfOpen(false)} />}

      <ValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        onCountChange={setPendingCount}
      />

      <UsersDialog
        open={usersOpen}
        onClose={() => setUsersOpen(false)}
        currentUserId={user?.id ?? ""}
      />

      <AuthDialog
        open={!authLoading && authOpen && !user}
        onBeginOAuth={() => {
          window.location.href = `/auth/google/login?returnTo=${encodeURIComponent(window.location.href)}`;
        }}
        onSuccess={() => {
          fetch("/api/auth/me", { credentials: "include" })
            .then((r) => r.ok ? r.json() : null)
            .then((u) => { if (u) { setUser(u); setAuthOpen(false); } });
        }}
      />

      <AnimatePresence>
        {verifiedBanner && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            style={{
              position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
              background: "#16a34a", color: "#fff", padding: "12px 24px", borderRadius: 10,
              fontSize: 14, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <CheckCircle2 className="h-5 w-5" />
            Email confirmed! Your account is awaiting admin approval.
          </motion.div>
        )}
        {pendingBanner && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
            style={{
              position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
              background: "#f59e0b", color: "#fff", padding: "12px 24px", borderRadius: 10,
              fontSize: 14, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              display: "flex", alignItems: "center", gap: 8, maxWidth: "90vw", textAlign: "center",
            }}
          >
            ⏳ Your account is awaiting admin approval. You will receive an email once validated.
            <button onClick={() => setPendingBanner(false)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", marginLeft: 8, fontSize: 16 }}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
