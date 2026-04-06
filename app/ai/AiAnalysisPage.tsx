"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { AiSessionListItem, AiMessage } from "../lib/db";
import { AGENTS, getAgentList } from "../lib/agents";

// ── Helpers ──────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const mins = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}sem`;
}

function statusBadge(status: string) {
  if (status === "completed") return { text: "Completada", color: "bg-green-500/15 text-green-400 border-green-500/30" };
  return { text: "En progreso", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" };
}

function phaseBadge(phase: string) {
  if (phase === "analysis") return { text: "Análisis", color: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" };
  return { text: "Briefing", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" };
}

// ── Main Component ───────────────────────────────────

interface Props {
  initialSessions: AiSessionListItem[];
  datasets: { id: number; name: string; posts_count: number }[];
  hasGeminiKey: boolean;
}

export function AiAnalysisPage({ initialSessions, datasets, hasGeminiKey }: Props) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [sessionDetail, setSessionDetail] = useState<{ session: AiSessionListItem; messages: AiMessage[] } | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "in_progress" | "completed">("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Session loading ──
  const loadSession = useCallback(async (sessionId: number) => {
    try {
      const res = await fetch(`/api/ai/sessions/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSessionDetail(data);
      // Filter out system messages for display
      setMessages(data.messages.filter((m: AiMessage) => m.role !== "system"));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      loadSession(selectedSessionId);
    } else {
      setSessionDetail(null);
      setMessages([]);
    }
  }, [selectedSessionId, loadSession]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-focus input
  useEffect(() => {
    if (selectedSessionId && !isStreaming) {
      inputRef.current?.focus();
    }
  }, [selectedSessionId, isStreaming]);

  // If session is new (0 visible messages), trigger first assistant message
  useEffect(() => {
    if (sessionDetail && messages.length === 0 && !isStreaming) {
      sendMessage("Hola, estoy listo para empezar.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionDetail?.session.id]);

  // ── Send message ──
  async function sendMessage(text?: string) {
    const msg = text || inputText.trim();
    if (!msg || isStreaming || !selectedSessionId) return;

    setInputText("");
    setIsStreaming(true);
    setStreamingText("");

    // Optimistically add user message (unless it's the auto-trigger)
    if (!text) {
      setMessages(prev => [...prev, { id: Date.now(), session_id: selectedSessionId, role: "user", content: msg, created_at: new Date().toISOString() }]);
    }

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: selectedSessionId, message: msg }),
      });

      if (!response.ok) {
        const data = await response.json();
        setMessages(prev => [...prev, { id: Date.now(), session_id: selectedSessionId, role: "assistant", content: `Error: ${data.error}`, created_at: new Date().toISOString() }]);
        setIsStreaming(false);
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              // Phase transition happened
              if (data.briefing_complete) {
                // Reload session to get updated phase
                await loadSession(selectedSessionId);
              }
              break;
            }
            if (data.error) {
              assistantText += `\n\n⚠️ ${data.error}`;
              setStreamingText(assistantText);
              break;
            }
            if (data.text) {
              assistantText += data.text;
              setStreamingText(assistantText);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // Add final assistant message
      if (assistantText) {
        // Strip briefing marker from display
        const cleanText = assistantText.replace("[BRIEFING_COMPLETE]", "").trim();
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          session_id: selectedSessionId,
          role: "assistant",
          content: cleanText,
          created_at: new Date().toISOString(),
        }]);
      }

      setStreamingText("");

      // Update session in list (move to top)
      setSessions(prev => {
        const updated = prev.map(s =>
          s.id === selectedSessionId ? { ...s, updated_at: new Date().toISOString(), message_count: s.message_count + 2 } : s
        );
        updated.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return updated;
      });
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        session_id: selectedSessionId!,
        role: "assistant",
        content: "Error de conexión. Intentá de nuevo.",
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Filter sessions ──
  const filteredSessions = sessions.filter(s => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) ||
        s.dataset_name.toLowerCase().includes(q) ||
        (s.tags || []).some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  const currentSession = sessionDetail?.session;
  const currentPhase = currentSession?.phase || "briefing";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Global Sidebar */}
      <aside className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-sm font-bold tracking-wide text-indigo-400 uppercase">Antigravity</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Content Dashboard</p>
        </div>
        <nav className="p-3 flex flex-col gap-1">
          <Link href="/" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Dashboard</Link>
          <Link href="/researches" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Investigaciones</Link>
          <Link href="/datasets" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Datasets</Link>
          <Link href="/ai" className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400 transition-colors">AI Analysis</Link>
          <Link href="/settings" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Configuración</Link>
        </nav>
      </aside>

      {/* Content area: sessions list + chat */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sessions panel */}
        <div className="w-[280px] shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
          <div className="p-3 border-b border-[var(--border)]">
            <button
              onClick={() => setShowCreateModal(true)}
              className="w-full px-3 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
            >
              + Nueva sesión
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pt-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar sesiones..."
              className="w-full px-2.5 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Status filter */}
          <div className="flex gap-1 px-3 py-2">
            {(["all", "in_progress", "completed"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  filterStatus === f
                    ? "bg-indigo-500/15 text-indigo-400"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {f === "all" ? "Todas" : f === "in_progress" ? "En progreso" : "Completadas"}
              </button>
            ))}
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto">
            {filteredSessions.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-8">No hay sesiones</p>
            ) : (
              filteredSessions.map(s => {
                const agentDef = AGENTS[s.agent_type];
                const badge = statusBadge(s.status);
                const isActive = s.id === selectedSessionId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSessionId(s.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition-colors ${
                      isActive ? "bg-indigo-500/10" : "hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs">{agentDef?.icon || "🤖"}</span>
                      <span className="text-sm text-[var(--text-primary)] truncate flex-1">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                      <span className="truncate">{s.dataset_name}</span>
                      <span>·</span>
                      <span>{timeAgo(s.updated_at)}</span>
                      <span className={`px-1 py-0.5 rounded border ${badge.color}`}>{badge.text}</span>
                    </div>
                    {s.tags?.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {s.tags.slice(0, 3).map(t => (
                          <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-zinc-500/10 text-[var(--text-muted)]">{t}</span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex-1 flex flex-col bg-[var(--bg-primary)]">
          {!hasGeminiKey && (
            <div className="px-5 py-2 bg-yellow-500/10 border-b border-yellow-500/30 text-xs text-yellow-300">
              Para usar AI Analysis necesitás configurar tu <Link href="/settings" className="underline text-yellow-200">API Key de Gemini</Link>.
            </div>
          )}

          {currentSession ? (
            <>
              {/* Context bar */}
              <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{currentSession.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${phaseBadge(currentPhase).color}`}>
                  {phaseBadge(currentPhase).text}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  Dataset: {currentSession.dataset_name}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {AGENTS[currentSession.agent_type]?.icon} {AGENTS[currentSession.agent_type]?.name}
                </span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {messages.map(msg => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {streamingText && (
                  <MessageBubble
                    message={{ id: -1, session_id: selectedSessionId!, role: "assistant", content: streamingText, created_at: "" }}
                    isStreaming
                  />
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isStreaming ? "Esperando respuesta..." : "Escribí tu mensaje..."}
                    disabled={isStreaming}
                    rows={1}
                    className="flex-1 px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
                  />
                  <button
                    onClick={() => sendMessage()}
                    disabled={isStreaming || !inputText.trim()}
                    className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-[var(--text-muted)]">Seleccioná una sesión o creá una nueva</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="mt-3 px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
                >
                  + Nueva sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create session modal */}
      {showCreateModal && (
        <CreateSessionModal
          datasets={datasets}
          onClose={() => setShowCreateModal(false)}
          onCreate={async (session) => {
            setSessions(prev => [session, ...prev]);
            setSelectedSessionId(session.id);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────

function MessageBubble({ message, isStreaming }: { message: AiMessage; isStreaming?: boolean }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg px-4 py-3 ${
        isUser
          ? "bg-indigo-500/15 border border-indigo-500/30"
          : "bg-[var(--bg-secondary)] border border-[var(--border)]"
      }`}>
        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
          {message.content}
          {isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-indigo-400 animate-pulse" />}
        </p>
      </div>
    </div>
  );
}

// ── Create Session Modal ─────────────────────────────

function CreateSessionModal({
  datasets,
  onClose,
  onCreate,
}: {
  datasets: { id: number; name: string; posts_count: number }[];
  onClose: () => void;
  onCreate: (session: AiSessionListItem) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState("");
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const agents = getAgentList();

  async function handleCreate() {
    if (!agentType || !datasetId) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/ai/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          agent_type: agentType,
          dataset_id: datasetId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error creando sesión");
      }

      const session = await res.json();
      onCreate(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold">Nueva sesión de análisis</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl px-2">×</button>
        </div>

        <div className="p-4">
          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-4">
            {[1, 2, 3].map(s => (
              <div key={s} className={`flex items-center gap-1.5 text-xs ${
                step === s ? "text-indigo-400" : step > s ? "text-green-400" : "text-[var(--text-muted)]"
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
                  step === s ? "border-indigo-500 bg-indigo-500/20" : step > s ? "border-green-500 bg-green-500/20" : "border-[var(--border)]"
                }`}>{step > s ? "✓" : s}</span>
                <span>{s === 1 ? "Nombre" : s === 2 ? "Agente" : "Dataset"}</span>
              </div>
            ))}
          </div>

          {/* Step 1: Name */}
          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Nombre de la sesión (opcional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Se genera automáticamente si lo dejás vacío"
                  className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button onClick={() => setStep(2)}
                className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
                Siguiente
              </button>
            </div>
          )}

          {/* Step 2: Agent selection */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">Seleccioná un agente de análisis</p>
              <div className="grid gap-2">
                {agents.map(a => (
                  <button
                    key={a.type}
                    onClick={() => { setAgentType(a.type); setStep(3); }}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      agentType === a.type
                        ? "border-indigo-500 bg-indigo-500/10"
                        : "border-[var(--border)] hover:border-indigo-500/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{a.icon}</span>
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{a.name}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{a.description}</p>
                  </button>
                ))}
                {/* Coming soon placeholder */}
                <div className="p-3 rounded-lg border border-[var(--border)] opacity-40 cursor-not-allowed">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📖</span>
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Narrative Analyst</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400 border border-zinc-500/30">Próximamente</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Analiza estructura narrativa, picos de curiosidad y desarrollo del video</p>
                </div>
              </div>
              <button onClick={() => setStep(1)}
                className="px-4 py-2 text-sm rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                Atrás
              </button>
            </div>
          )}

          {/* Step 3: Dataset selection */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">Seleccioná un dataset para analizar</p>
              {datasets.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-xs text-[var(--text-muted)]">No hay datasets disponibles</p>
                  <Link href="/datasets" className="text-xs text-indigo-400 hover:text-indigo-300">Crear un dataset</Link>
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {datasets.map(d => (
                    <button
                      key={d.id}
                      onClick={() => setDatasetId(d.id)}
                      className={`w-full text-left px-3 py-2 rounded transition-colors ${
                        datasetId === d.id
                          ? "bg-indigo-500/10 border border-indigo-500"
                          : "border border-[var(--border)] hover:border-indigo-500/30"
                      }`}
                    >
                      <span className="text-sm text-[var(--text-primary)]">{d.name}</span>
                      <span className="text-xs text-[var(--text-muted)] ml-2">{d.posts_count} posts</span>
                    </button>
                  ))}
                </div>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex gap-2">
                <button onClick={() => setStep(2)}
                  className="px-4 py-2 text-sm rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                  Atrás
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!datasetId || submitting}
                  className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Creando..." : "Crear sesión"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
