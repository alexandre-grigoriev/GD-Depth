import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Mic } from "lucide-react";
import { Card } from "../ui/Card";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";
import { cn, t } from "../../utils";
import type { ChatSummary, ChatMessage } from "../../types";

export function ChatPanel({
  chat,
  messages,
  lang,
  isThinking,
  input,
  onInputChange,
  onSend,
  contextTokens = 0,
  contextLimit  = 16_000,
}: {
  chat: ChatSummary | null;
  messages: ChatMessage[];
  lang: string;
  isThinking: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSend: (text?: string) => void;
  contextTokens?: number;
  contextLimit?: number;
}) {
  const contextWarn  = contextTokens >= Math.round(contextLimit * 0.875);
  const contextFull  = contextTokens >= contextLimit;
  const scrollRef = useRef<HTMLDivElement>(null);
  const speech = useSpeechRecognition(lang);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const ZOOM_STEP = 0.4;
  const ZOOM_MAX  = 6;
  const ZOOM_MIN  = 0.5;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isThinking]);

  // Reset zoom when lightbox opens/closes
  useEffect(() => { setZoom(1); }, [lightboxUrl]);

  // Close on Escape; +/- keys to zoom
  useEffect(() => {
    if (!lightboxUrl) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setLightboxUrl(null); return; }
      if (e.key === "+" || e.key === "=") setZoom(z => Math.min(z + ZOOM_STEP, ZOOM_MAX));
      if (e.key === "-")                  setZoom(z => Math.max(z - ZOOM_STEP, ZOOM_MIN));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  return (
    <>
      <Card className="chatCard">
        <div className="chatHeader">
          <div className="chatTitle">{chat?.title ?? "Contextual Knowledge System"}</div>
          <div className="chatSub">Ask anything. Get everything.</div>
        </div>

        <div className="chatBody">
          <div className="chatScroll" ref={scrollRef}>
            {messages.length === 0 && !isThinking && (
              <div className="msgRow msgRowAsst">
                <div className="msgMeta"><span className="msgRole">ASSISTANT</span></div>
                <div className="msgBubble msgBubbleAsst">
                  {t(lang).welcome}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("msgRow", m.role === "user" ? "msgRowUser" : "msgRowAsst")}>
                <div className="msgMeta">
                  <span className="msgRole">{m.role === "user" ? "YOU" : "ASSISTANT"}</span>
                  <span className="msgTime">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className={cn("msgBubble", m.role === "user" ? "msgBubbleUser" : "msgBubbleAsst")}>
                  {m.role === "assistant"
                    ? <div className="mdContent"><ReactMarkdown>{m.text}</ReactMarkdown></div>
                    : m.text}
                  {m.role === "assistant" && m.images && m.images.length > 0 && (
                    <div className="msgImages">
                      {m.images.map((url) => {
                        const title = url.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") ?? "";
                        return (
                        <figure key={url} className="msgImageFigure">
                          <img
                            src={url}
                            alt={title}
                            className="msgImage"
                            onClick={() => setLightboxUrl(url)}
                          />
                          {title && <figcaption className="msgImageCaption">{title}</figcaption>}
                        </figure>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="msgRow msgRowAsst">
                <div className="msgMeta"><span className="msgRole">ASSISTANT</span></div>
                <div className="msgBubble msgBubbleAsst msgBubbleThinking">
                  <span className="thinkingDot" /><span className="thinkingDot" /><span className="thinkingDot" />
                </div>
              </div>
            )}
          </div>

          {/* Context limit banner */}
          {contextWarn && (
            <div style={{
              margin: "0 0 8px",
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: contextFull ? "#fef2f2" : "#fffbeb",
              color:      contextFull ? "#b91c1c"  : "#92400e",
              border:     `1px solid ${contextFull ? "#fecaca" : "#fde68a"}`,
            }}>
              {contextFull ? "⛔" : "⚠️"}
              <span>
                {contextFull
                  ? `Context limit reached (${(contextTokens / 1000).toFixed(1)}k / ${contextLimit / 1000}k tokens). Please start a new chat to continue.`
                  : `Chat context is ${(contextTokens / 1000).toFixed(1)}k / ${contextLimit / 1000}k tokens — consider starting a new chat soon.`}
              </span>
            </div>
          )}

          <div className="chatInputRow">
            <input
              className="chatInput"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && input.trim() && !contextFull) onSend(); }}
              placeholder={contextFull ? "Context limit reached — please start a new chat." : "Type your question…"}
              disabled={isThinking || contextFull}
            />
            {input.trim() ? (
              <button className="chatInputIconBtn" onClick={() => onSend()} disabled={isThinking || contextFull} title="Send">
                <img src="/send.png" alt="Send" className="chatInputIcon" />
              </button>
            ) : (
              <button
                className={cn("chatInputIconBtn", speech.isRecording && "chatMicRecording")}
                title={contextFull ? "Context limit reached" : speech.supported ? (speech.isRecording ? "Release to send" : "Hold to speak") : "Voice not supported"}
                onPointerDown={(e) => { e.preventDefault(); if (!contextFull) speech.start((text) => onSend(text)); }}
                onPointerUp={(e) => { e.preventDefault(); speech.stop(); }}
                onPointerLeave={(e) => { e.preventDefault(); if (speech.isRecording) speech.stop(); }}
                onPointerCancel={(e) => { e.preventDefault(); if (speech.isRecording) speech.stop(); }}
                disabled={!speech.supported || contextFull}
              >
                {speech.isRecording
                  ? <Mic className="chatInputIcon" style={{ color: "#e53e3e" }} />
                  : <img src="/microphone.png" alt="Mic" className="chatInputIcon" />}
              </button>
            )}
          </div>
        </div>
      </Card>

      {lightboxUrl && (() => {
        const title = lightboxUrl.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") ?? "";
        return (
          <div
            className="imgLightbox"
            onClick={() => setLightboxUrl(null)}
            onWheel={(e) => {
              e.preventDefault();
              setZoom(z => Math.min(Math.max(z - e.deltaY * 0.001, ZOOM_MIN), ZOOM_MAX));
            }}
          >
            <figure className="imgLightboxFigure" onClick={(e) => e.stopPropagation()}>
              <img
                src={lightboxUrl}
                alt={title}
                className="imgLightboxImg"
                style={{ transform: `scale(${zoom})`, transformOrigin: "center center", cursor: zoom < ZOOM_MAX ? "zoom-in" : "zoom-out" }}
                onClick={() => setZoom(z => z < ZOOM_MAX ? Math.min(z + ZOOM_STEP, ZOOM_MAX) : 1)}
              />
              {title && <figcaption className="imgLightboxCaption">{title}</figcaption>}
            </figure>
          </div>
        );
      })()}
    </>
  );
}
