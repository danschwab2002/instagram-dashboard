"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dataset } from "../lib/db";

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return { text: "Activo", color: "bg-green-500/15 text-green-400 border-green-500/30" };
    case "analyzed":
      return { text: "Analizado", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "archived":
      return { text: "Archivado", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" };
    default:
      return { text: "Borrador", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" };
  }
}

function parseTags(input: string): string[] {
  return input
    .split(/[,\n]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

export function DatasetsPage({ datasets }: { datasets: Dataset[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [niche, setNiche] = useState("");
  const [objective, setObjective] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          context: context.trim() || undefined,
          niche: niche.trim() || undefined,
          objective: objective.trim() || undefined,
          tags: parseTags(tagsInput),
          keywords: parseTags(keywordsInput),
          additional_notes: additionalNotes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error creando dataset");
      }

      const data = await res.json();
      setShowForm(false);
      setName("");
      setDescription("");
      setContext("");
      setNiche("");
      setObjective("");
      setTagsInput("");
      setKeywordsInput("");
      setAdditionalNotes("");
      router.push(`/datasets/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500";

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
          <Link href="/datasets" className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400 transition-colors">Datasets</Link>
          <Link href="/ai" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">AI Analysis</Link>
          <Link href="/instagram" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Mi Instagram</Link>
          <Link href="/settings" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Configuración</Link>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div>
            <h2 className="text-lg font-semibold">Datasets</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {datasets.length} dataset{datasets.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
          >
            + Nuevo dataset
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {/* Create form */}
          {showForm && (
            <div className="mb-6 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
              <h3 className="text-sm font-semibold mb-3">Nuevo dataset</h3>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Nombre *</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="Ej: Top Reels Fitness Q1" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Nicho</label>
                    <input type="text" value={niche} onChange={(e) => setNiche(e.target.value)}
                      placeholder="Ej: Fitness, AI/Tech, Cocina..." className={inputClass} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Descripción</label>
                  <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder="Breve descripción del dataset" className={inputClass} />
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Contexto</label>
                  <textarea value={context} onChange={(e) => setContext(e.target.value)}
                    placeholder="Para qué se creó este dataset, qué se busca analizar..."
                    rows={2} className={inputClass} />
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Objetivo</label>
                  <input type="text" value={objective} onChange={(e) => setObjective(e.target.value)}
                    placeholder="Qué tipo de análisis se va a hacer con este dataset" className={inputClass} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Tags (separados por coma)</label>
                    <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="hooks, engagement, viral..." className={inputClass} />
                    {parseTags(tagsInput).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {parseTags(tagsInput).map((t) => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Keywords (separadas por coma)</label>
                    <input type="text" value={keywordsInput} onChange={(e) => setKeywordsInput(e.target.value)}
                      placeholder="productividad, morning routine..." className={inputClass} />
                    {parseTags(keywordsInput).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {parseTags(keywordsInput).map((k) => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30">{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Notas adicionales</label>
                  <textarea value={additionalNotes} onChange={(e) => setAdditionalNotes(e.target.value)}
                    placeholder="Información extra relevante para el análisis..."
                    rows={2} className={inputClass} />
                </div>

                {error && <p className="text-xs text-red-400">{error}</p>}

                <div className="flex gap-2">
                  <button type="submit" disabled={submitting || !name.trim()}
                    className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {submitting ? "Creando..." : "Crear dataset"}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)}
                    className="px-4 py-2 text-sm rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Dataset list */}
          {datasets.length === 0 && !showForm ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              <p className="text-sm">No hay datasets todavía</p>
              <p className="text-xs mt-1">Creá uno y agregá reels desde el Dashboard</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {datasets.map((d) => {
                const badge = statusBadge(d.status);
                return (
                  <Link
                    key={d.id}
                    href={`/datasets/${d.id}`}
                    className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-indigo-500/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{d.name}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${badge.color}`}>{badge.text}</span>
                      </div>
                      {d.description && (
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{d.description}</p>
                      )}
                      {d.niche && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-[var(--text-muted)] border border-[var(--border)] mt-1 inline-block">{d.niche}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] shrink-0 ml-4">
                      <span>{d.posts_count} posts</span>
                      <span>{d.creators_count} creadores</span>
                      <span>{new Date(d.created_at).toLocaleDateString("es-AR")}</span>
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
