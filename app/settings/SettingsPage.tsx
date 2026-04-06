"use client";

import Link from "next/link";
import { useState } from "react";

const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI", keyField: "openai" },
  { value: "gemini", label: "Google Gemini", keyField: "gemini" },
  { value: "claude", label: "Anthropic Claude", keyField: "claude" },
];

export function SettingsPage({
  userEmail,
  apifyApiKey: initialApifyKey,
  geminiApiKey: initialGeminiKey,
  openaiApiKey: initialOpenaiKey,
  claudeApiKey: initialClaudeKey,
  aiProvider: initialProvider,
}: {
  userEmail: string;
  apifyApiKey: string;
  geminiApiKey: string;
  openaiApiKey: string;
  claudeApiKey: string;
  aiProvider: string;
}) {
  const [apifyApiKey, setApifyApiKey] = useState(initialApifyKey);
  const [geminiApiKey, setGeminiApiKey] = useState(initialGeminiKey);
  const [openaiApiKey, setOpenaiApiKey] = useState(initialOpenaiKey);
  const [claudeApiKey, setClaudeApiKey] = useState(initialClaudeKey);
  const [aiProvider, setAiProvider] = useState(initialProvider);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const toggleKey = (key: string) => setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apify_api_key: apifyApiKey.trim() || null,
          gemini_api_key: geminiApiKey.trim() || null,
          openai_api_key: openaiApiKey.trim() || null,
          claude_api_key: claudeApiKey.trim() || null,
          ai_provider: aiProvider,
        }),
      });
      if (!res.ok) throw new Error("Error guardando configuración");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500 font-mono pr-16";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-sm font-bold tracking-wide text-indigo-400 uppercase">Antigravity</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Content Dashboard</p>
        </div>
        <nav className="p-3 flex flex-col gap-1">
          <Link href="/" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Dashboard</Link>
          <Link href="/researches" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Investigaciones</Link>
          <Link href="/datasets" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Datasets</Link>
          <Link href="/ai" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">AI Analysis</Link>
          <Link href="/settings" className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400 transition-colors">Configuración</Link>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <h2 className="text-lg font-semibold">Configuración</h2>
          <p className="text-xs text-[var(--text-muted)]">{userEmail}</p>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <div className="max-w-lg space-y-6">
            {/* Apify API Key */}
            <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <h3 className="text-sm font-semibold mb-1">API Key de Apify</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Se usa para ejecutar los scrapers de Instagram. La encontrás en apify.com → Settings → Integrations.
              </p>
              <div className="flex-1 relative">
                <input type={showKeys.apify ? "text" : "password"} value={apifyApiKey}
                  onChange={(e) => setApifyApiKey(e.target.value)} placeholder="apify_api_..." className={inputClass} />
                <button type="button" onClick={() => toggleKey("apify")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                  {showKeys.apify ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {/* AI Provider selector */}
            <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <h3 className="text-sm font-semibold mb-1">Proveedor de IA</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Seleccioná qué modelo de IA usar para AI Analysis y pre-análisis de reels.
              </p>
              <div className="flex gap-2">
                {AI_PROVIDERS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setAiProvider(p.value)}
                    className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                      aiProvider === p.value
                        ? "border-indigo-500 bg-indigo-500/15 text-indigo-400"
                        : "border-[var(--border)] text-[var(--text-secondary)] hover:border-indigo-500/30"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* OpenAI API Key */}
            <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold">API Key de OpenAI</h3>
                {aiProvider === "openai" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">Activo</span>}
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                La encontrás en platform.openai.com → API Keys.
              </p>
              <div className="flex-1 relative">
                <input type={showKeys.openai ? "text" : "password"} value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)} placeholder="sk-..." className={inputClass} />
                <button type="button" onClick={() => toggleKey("openai")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                  {showKeys.openai ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {/* Gemini API Key */}
            <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold">API Key de Gemini</h3>
                {aiProvider === "gemini" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">Activo</span>}
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                La encontrás en aistudio.google.com → API Keys.
              </p>
              <div className="flex-1 relative">
                <input type={showKeys.gemini ? "text" : "password"} value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)} placeholder="AIzaSy..." className={inputClass} />
                <button type="button" onClick={() => toggleKey("gemini")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                  {showKeys.gemini ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {/* Claude API Key */}
            <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold">API Key de Claude</h3>
                {aiProvider === "claude" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">Activo</span>}
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                La encontrás en console.anthropic.com → API Keys.
              </p>
              <div className="flex-1 relative">
                <input type={showKeys.claude ? "text" : "password"} value={claudeApiKey}
                  onChange={(e) => setClaudeApiKey(e.target.value)} placeholder="sk-ant-..." className={inputClass} />
                <button type="button" onClick={() => toggleKey("claude")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                  {showKeys.claude ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3">
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50">
                {saving ? "Guardando..." : "Guardar configuración"}
              </button>
              {error && <p className="text-xs text-red-400">{error}</p>}
              {saved && <p className="text-xs text-green-400">Guardado correctamente</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
