"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Research {
  id: number;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  accounts_count: number;
  posts_count: number;
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return { text: "Completada", color: "bg-green-500/15 text-green-400 border-green-500/30" };
    case "scraping":
      return { text: "Scrapeando...", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" };
    case "failed":
      return { text: "Error", color: "bg-red-500/15 text-red-400 border-red-500/30" };
    default:
      return { text: "Borrador", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" };
  }
}

function parseUsernames(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((line) => {
      let cleaned = line.trim();
      // Quitar @ si lo tiene
      if (cleaned.startsWith("@")) cleaned = cleaned.slice(1);
      // Validar que sea un username válido
      if (/^[a-zA-Z0-9_.]+$/.test(cleaned)) return cleaned;
      return "";
    })
    .filter((u) => u.length > 0);
}

export function ResearchesPage({ researches }: { researches: Research[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accountsInput, setAccountsInput] = useState("");
  const [daysBack, setDaysBack] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const parsedUsernames = parseUsernames(accountsInput);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || parsedUsernames.length === 0) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/researches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          usernames: parsedUsernames,
          days_back: daysBack,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error creando investigación");
      }

      setShowForm(false);
      setName("");
      setDescription("");
      setAccountsInput("");
      setDaysBack(30);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
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
            className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400 transition-colors"
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
            className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Configuración
          </Link>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div>
            <h2 className="text-lg font-semibold">Investigaciones</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {researches.length} investigacion{researches.length !== 1 ? "es" : ""}
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
          >
            + Nueva investigación
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {/* New research form */}
          {showForm && (
            <div className="mb-6 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <h3 className="text-sm font-semibold mb-3">Nueva investigación</h3>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Nombre *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: Creadores de AI, Fitness Niche..."
                    className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Descripción (opcional)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Breve descripción del objetivo de esta investigación"
                    className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Días hacia atrás
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={daysBack}
                      onChange={(e) => setDaysBack(Math.max(1, Math.min(365, parseInt(e.target.value) || 30)))}
                      min={1}
                      max={365}
                      className="w-24 px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 tabular-nums"
                    />
                    <span className="text-xs text-[var(--text-muted)]">
                      Scrapear posts de los últimos {daysBack} días
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Cuentas de Instagram *
                  </label>
                  <textarea
                    value={accountsInput}
                    onChange={(e) => setAccountsInput(e.target.value)}
                    placeholder={"Pegá usernames, uno por línea:\nkylewhitrow\n@daniel.blort\nlaz.fran"}
                    rows={6}
                    className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  {parsedUsernames.length > 0 && (
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {parsedUsernames.length} cuenta{parsedUsernames.length !== 1 ? "s" : ""} detectada{parsedUsernames.length !== 1 ? "s" : ""}:{" "}
                      <span className="text-[var(--text-secondary)]">
                        {parsedUsernames.map((u) => `@${u}`).join(", ")}
                      </span>
                    </p>
                  )}
                </div>

                {error && (
                  <p className="text-xs text-red-400">{error}</p>
                )}

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting || !name.trim() || parsedUsernames.length === 0}
                    className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? "Creando..." : "Crear investigación"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-4 py-2 text-sm rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Research list */}
          {researches.length === 0 && !showForm ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              <p className="text-sm">No hay investigaciones todavía</p>
              <p className="text-xs mt-1">Creá una para empezar a scrapear cuentas</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {researches.map((r) => {
                const badge = statusBadge(r.status);
                return (
                  <Link
                    key={r.id}
                    href={`/researches/${r.id}`}
                    className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-indigo-500/30 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          {r.name}
                        </h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.color}`}>
                          {badge.text}
                        </span>
                      </div>
                      {r.description && (
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{r.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                      <span>{r.accounts_count} cuentas</span>
                      <span>{r.posts_count} posts</span>
                      <span>{new Date(r.created_at).toLocaleDateString("es-AR")}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
