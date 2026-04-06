"use client";

import Link from "next/link";
import { useState } from "react";

export function SettingsPage({
  userEmail,
  apifyApiKey: initialApifyKey,
  geminiApiKey: initialGeminiKey,
}: {
  userEmail: string;
  apifyApiKey: string;
  geminiApiKey: string;
}) {
  const [apifyApiKey, setApifyApiKey] = useState(initialApifyKey);
  const [geminiApiKey, setGeminiApiKey] = useState(initialGeminiKey);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

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

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-sm font-bold tracking-wide text-indigo-400 uppercase">
            Antigravity
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Content Dashboard</p>
        </div>

        <nav className="p-3 flex flex-col gap-1">
          <Link
            href="/"
            className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/researches"
            className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Investigaciones
          </Link>
          <Link
            href="/datasets"
            className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Datasets
          </Link>
          <Link
            href="/settings"
            className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400 transition-colors"
          >
            Configuración
          </Link>
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
                Tu API key personal de Apify. Se usa para ejecutar los scrapers de Instagram.
                La encontrás en apify.com → Settings → Integrations.
              </p>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apifyApiKey}
                    onChange={(e) => setApifyApiKey(e.target.value)}
                    placeholder="apify_api_..."
                    className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500 font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    {showKey ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>
            </div>

            {/* Gemini API Key */}
            <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <h3 className="text-sm font-semibold mb-1">API Key de Gemini</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Tu API key de Google Gemini. Se usa para el análisis profundo de videos con IA.
                La encontrás en aistudio.google.com → API Keys.
              </p>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showGeminiKey ? "text" : "password"}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500 font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    {showGeminiKey ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
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
