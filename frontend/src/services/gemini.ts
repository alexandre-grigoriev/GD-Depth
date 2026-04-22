/**
 * services/gemini.ts — chat service backed by the Node.js backend.
 *
 * All LLM calls (Claude via Bedrock) and KB retrieval happen server-side
 * via POST /api/chat. No Gemini API key needed in the frontend.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export function estimateTokens(history: ChatMessage[], pendingInput = ""): number {
  const SYSTEM_OVERHEAD = 2_000;
  const historyChars = history.reduce((sum, m) => sum + m.text.length, 0);
  return SYSTEM_OVERHEAD + Math.ceil((historyChars + pendingInput.length) / 4);
}

export async function sendToGemini(
  message: string,
  history: ChatMessage[],
  lang = "en"
): Promise<{ text: string; images: string[] }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, lang }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `Chat API error: ${res.status}`);
  }

  return res.json();
}
