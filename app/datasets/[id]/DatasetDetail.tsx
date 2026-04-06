"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { DatasetDetail as DatasetDetailType, DatasetPost } from "../../lib/db";

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

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatPercent(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return (n * 100).toFixed(2) + "%";
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "\u2014";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}sem`;
  return `${Math.floor(days / 30)}m`;
}

function engagementColor(rate: number | null): string {
  if (rate == null) return "text-zinc-500";
  if (rate >= 0.05) return "text-green-400";
  if (rate >= 0.03) return "text-emerald-400";
  if (rate >= 0.01) return "text-yellow-400";
  return "text-red-400";
}

function scoreColor(score: number | null): string {
  if (score == null) return "text-zinc-500";
  if (score >= 0.7) return "text-green-400 font-semibold";
  if (score >= 0.4) return "text-yellow-400";
  if (score >= 0.2) return "text-orange-400";
  return "text-red-400";
}

const inputClass = "w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500";

export function DatasetDetail({
  dataset,
  posts,
}: {
  dataset: DatasetDetailType;
  posts: DatasetPost[];
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<number>>(new Set());
  const [selectedPost, setSelectedPost] = useState<DatasetPost | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState(false);

  // Editable fields
  const [name, setName] = useState(dataset.name);
  const [description, setDescription] = useState(dataset.description || "");
  const [context, setContext] = useState(dataset.context || "");
  const [niche, setNiche] = useState(dataset.niche || "");
  const [objective, setObjective] = useState(dataset.objective || "");
  const [tagsInput, setTagsInput] = useState((dataset.tags || []).join(", "));
  const [keywordsInput, setKeywordsInput] = useState((dataset.keywords || []).join(", "));
  const [additionalNotes, setAdditionalNotes] = useState(dataset.additional_notes || "");

  const badge = statusBadge(dataset.status);
  const createdDate = new Date(dataset.created_at);

  function parseTags(input: string): string[] {
    return input.split(/[,\n]+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/datasets/${dataset.id}`, { method: "DELETE" });
      if (res.ok) router.push("/datasets");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/datasets/${dataset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          context: context.trim() || null,
          niche: niche.trim() || null,
          objective: objective.trim() || null,
          tags: parseTags(tagsInput),
          keywords: parseTags(keywordsInput),
          additional_notes: additionalNotes.trim() || null,
        }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRemovePosts() {
    if (selectedPosts.size === 0) return;
    const res = await fetch(`/api/datasets/${dataset.id}/posts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_ids: Array.from(selectedPosts) }),
    });
    if (res.ok) {
      setSelectedPosts(new Set());
      router.refresh();
    }
  }

  async function handleAnalyze() {
    if (analyzingIds || selectedPosts.size === 0) return;
    setAnalyzingIds(true);
    try {
      const res = await fetch("/api/posts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: Array.from(selectedPosts) }),
      });
      if (res.ok) {
        setSelectedPosts(new Set());
        router.refresh();
      } else {
        const data = await res.json();
        alert(data.error || "Error al iniciar análisis");
      }
    } finally {
      setAnalyzingIds(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedPosts.size === posts.length) {
      setSelectedPosts(new Set());
    } else {
      setSelectedPosts(new Set(posts.map((p) => p.id)));
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-sm font-bold tracking-wide text-indigo-400 uppercase">Antigravity</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Content Dashboard</p>
        </div>

        <nav className="p-3 border-b border-[var(--border)] flex flex-col gap-1">
          <Link href="/" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Dashboard</Link>
          <Link href="/researches" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Investigaciones</Link>
          <Link href="/datasets" className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400 transition-colors">Datasets</Link>
          <Link href="/settings" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Configuración</Link>
        </nav>

        {/* Dataset info sidebar */}
        <div className="flex-1 overflow-y-auto p-3">
          {dataset.creators.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-semibold">
                Creadores ({dataset.creators.length})
              </p>
              {dataset.creators.map((c) => (
                <div key={c} className="px-2 py-1 text-sm text-[var(--text-secondary)] truncate">@{c}</div>
              ))}
            </div>
          )}

          {dataset.researches.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-semibold">
                Investigaciones
              </p>
              {dataset.researches.map((r) => (
                <Link key={r.id} href={`/researches/${r.id}`}
                  className="block px-2 py-1 text-sm text-indigo-400 hover:text-indigo-300 truncate">
                  {r.name}
                </Link>
              ))}
            </div>
          )}

          {(dataset.tags.length > 0 || dataset.keywords.length > 0) && (
            <div className="mb-3">
              {dataset.tags.length > 0 && (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-semibold">Tags</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {dataset.tags.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">{t}</span>
                    ))}
                  </div>
                </>
              )}
              {dataset.keywords.length > 0 && (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-semibold">Keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {dataset.keywords.map((k) => (
                      <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30">{k}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {dataset.scraped_range.min && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-semibold">Scrapeado</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {new Date(dataset.scraped_range.min).toLocaleDateString("es-AR")}
                {dataset.scraped_range.max && dataset.scraped_range.max !== dataset.scraped_range.min && (
                  <> — {new Date(dataset.scraped_range.max).toLocaleDateString("es-AR")}</>
                )}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-1">
            <Link href="/datasets" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
              ← Datasets
            </Link>
          </div>

          {editing ? (
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Nombre</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Nicho</label>
                  <input type="text" value={niche} onChange={(e) => setNiche(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Descripción</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Contexto</label>
                <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Objetivo</label>
                <input type="text" value={objective} onChange={(e) => setObjective(e.target.value)} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Tags</label>
                  <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Keywords</label>
                  <input type="text" value={keywordsInput} onChange={(e) => setKeywordsInput(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Notas adicionales</label>
                <textarea value={additionalNotes} onChange={(e) => setAdditionalNotes(e.target.value)} rows={2} className={inputClass} />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving || !name.trim()}
                  className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50">
                  {saving ? "Guardando..." : "Guardar cambios"}
                </button>
                <button onClick={() => { setEditing(false); setName(dataset.name); setDescription(dataset.description || ""); setContext(dataset.context || ""); setNiche(dataset.niche || ""); setObjective(dataset.objective || ""); setTagsInput((dataset.tags || []).join(", ")); setKeywordsInput((dataset.keywords || []).join(", ")); setAdditionalNotes(dataset.additional_notes || ""); }}
                  className="px-4 py-2 text-sm rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{dataset.name}</h2>
                <span className={`text-xs px-1.5 py-0.5 rounded border ${badge.color}`}>{badge.text}</span>
                {dataset.niche && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-500/10 text-[var(--text-muted)] border border-[var(--border)]">{dataset.niche}</span>
                )}
              </div>
              {dataset.description && <p className="text-sm text-[var(--text-muted)] mt-1">{dataset.description}</p>}
              {dataset.context && <p className="text-xs text-[var(--text-muted)] mt-1">Contexto: {dataset.context}</p>}
              {dataset.objective && <p className="text-xs text-[var(--text-muted)] mt-1">Objetivo: {dataset.objective}</p>}
              <div className="flex items-center gap-3 mt-2">
                <p className="text-xs text-[var(--text-muted)]">
                  Creado el {createdDate.toLocaleDateString("es-AR")}
                </p>
                <button onClick={() => setEditing(true)}
                  className="text-xs text-indigo-400/60 hover:text-indigo-400 transition-colors">
                  Editar
                </button>
                <a href={`/api/datasets/${dataset.id}`} download
                  className="text-xs text-indigo-400/60 hover:text-indigo-400 transition-colors">
                  Descargar JSON
                </a>
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors">
                    Eliminar
                  </button>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-red-400">Confirmar?</span>
                    <button onClick={handleDelete} disabled={deleting}
                      className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50">
                      {deleting ? "Eliminando..." : "Sí, eliminar"}
                    </button>
                    <button onClick={() => setConfirmDelete(false)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                      Cancelar
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
          <StatCard label="Posts" value={String(dataset.metrics.total_posts)} />
          <StatCard label="Creadores" value={String(dataset.metrics.total_creators)} />
          <MetricCard label="Views" median={dataset.metrics.median_views} min={dataset.metrics.min_views} max={dataset.metrics.max_views} />
          <MetricCard label="Likes" median={dataset.metrics.median_likes} min={dataset.metrics.min_likes} max={dataset.metrics.max_likes} />
          <MetricCard label="Engagement" median={dataset.metrics.median_engagement} min={dataset.metrics.min_engagement} max={dataset.metrics.max_engagement} isPercent />

          <div className="ml-auto flex items-center gap-2">
            {selectedPosts.size > 0 && (
              <>
                <span className="text-xs text-[var(--text-muted)]">{selectedPosts.size} seleccionados</span>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzingIds}
                  className={`px-3 py-1.5 text-xs rounded text-white transition-colors ${analyzingIds ? "bg-indigo-500/50 cursor-not-allowed" : "bg-indigo-500 hover:bg-indigo-600"}`}
                >
                  {analyzingIds ? "Enviando..." : "Analizar con IA"}
                </button>
                <button onClick={handleRemovePosts}
                  className="px-3 py-1.5 text-xs rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors">
                  Quitar del dataset
                </button>
              </>
            )}
            <Link href={`/?dataset_add=${dataset.id}`}
              className="px-3 py-1.5 text-xs rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
              + Agregar reels
            </Link>
          </div>
        </div>

        {/* Posts table */}
        <div className="flex-1 overflow-auto">
          {posts.length === 0 ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              <p className="text-sm">No hay posts en este dataset</p>
              <p className="text-xs mt-1">Agregá reels desde el Dashboard usando el botón "Agregar a dataset"</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
                <tr>
                  <th className="w-8 px-2 py-2">
                    <input type="checkbox" checked={selectedPosts.size === posts.length && posts.length > 0}
                      onChange={toggleSelectAll} className="accent-indigo-500" />
                  </th>
                  <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Creador</th>
                  <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Caption</th>
                  <th className="text-right px-4 py-2 text-[var(--text-muted)] font-medium">Views</th>
                  <th className="text-right px-4 py-2 text-[var(--text-muted)] font-medium">Likes</th>
                  <th className="text-right px-4 py-2 text-[var(--text-muted)] font-medium">Eng.</th>
                  <th className="text-right px-4 py-2 text-[var(--text-muted)] font-medium">Duración</th>
                  <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Publicado</th>
                  <th className="text-center px-4 py-2 text-[var(--text-muted)] font-medium">IA</th>
                  <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    onClick={() => setSelectedPost(p)}>
                    <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedPosts.has(p.id)}
                        onChange={() => toggleSelect(p.id)} className="accent-indigo-500" />
                    </td>
                    <td className="px-4 py-3 text-[var(--text-primary)]">
                      @{p.username}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate text-[var(--text-secondary)]">
                      {p.caption ? p.caption.slice(0, 80) + (p.caption.length > 80 ? "..." : "") : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">
                      {formatNumber(p.video_view_count)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">
                      {formatNumber(p.likes_count)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPercent(p.engagement_rate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                      {formatDuration(p.video_duration)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {p.posted_at ? timeAgo(p.posted_at) : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <AiStatusBadge status={p.analysis_status || "pending"} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)] max-w-[120px] truncate">
                      {p.dataset_note || "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* Post Modal */}
      {selectedPost && (
        <PostModal post={selectedPost} onClose={() => setSelectedPost(null)} />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="text-lg font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function MetricCard({ label, median, min, max, isPercent }: {
  label: string;
  median: number | null;
  min: number | null;
  max: number | null;
  isPercent?: boolean;
}) {
  const fmt = isPercent ? formatPercent : formatNumber;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="text-lg font-semibold text-[var(--text-primary)]">{fmt(median)}</p>
      <p className="text-[10px] text-[var(--text-muted)]">
        {fmt(min)} — {fmt(max)}
      </p>
    </div>
  );
}

// ── Post Modal (with AI analysis) ──────────────────────

function PostModal({ post, onClose }: { post: DatasetPost; onClose: () => void }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [analysis, setAnalysis] = useState<any>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisFetched, setAnalysisFetched] = useState(false);

  const loadAnalysis = async () => {
    if (analysisFetched) {
      setShowAnalysis(!showAnalysis);
      return;
    }
    setShowAnalysis(true);
    setAnalysisLoading(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/analysis`);
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
      }
    } finally {
      setAnalysisLoading(false);
      setAnalysisFetched(true);
    }
  };

  // Auto-load analysis on open
  useEffect(() => {
    loadAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const a = analysis;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">@{post.username}</p>
            <p className="text-xs text-[var(--text-muted)]">{post.type} · {formatDuration(post.video_duration)}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl px-2">×</button>
        </div>
        {post.stored_url ? (
          <div className="bg-black">
            <video src={post.stored_url} controls autoPlay className="w-full max-h-[60vh] object-contain" />
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-sm">Video no disponible</div>
        )}
        <div className="grid grid-cols-4 gap-3 p-4 border-b border-[var(--border)]">
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Views</p><p className="text-sm font-semibold">{formatNumber(post.video_view_count)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Likes</p><p className="text-sm font-semibold">{formatNumber(post.likes_count)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Comments</p><p className="text-sm font-semibold">{formatNumber(post.comments_count)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Shares</p><p className="text-sm font-semibold">{formatNumber(post.shares_count)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Eng. Rate</p><p className={`text-sm font-semibold ${engagementColor(post.engagement_rate)}`}>{formatPercent(post.engagement_rate)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Score</p><p className={`text-sm font-semibold ${scoreColor(post.performance_score)}`}>{post.performance_score != null ? (post.performance_score * 100).toFixed(1) : "\u2014"}</p></div>
        </div>
        {post.caption && (
          <div className="p-4 border-b border-[var(--border)]">
            <p className="text-[10px] uppercase text-[var(--text-muted)] mb-1">Caption</p>
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{post.caption}</p>
          </div>
        )}

        {/* AI Analysis section — auto-loaded */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <span>{showAnalysis ? "\u25BC" : "\u25B6"}</span>
              <span>Análisis IA</span>
            </button>
            <AiStatusBadge status={post.analysis_status || "pending"} />
          </div>

          {showAnalysis && (
            <div className="mt-1">
              {analysisLoading ? (
                <p className="text-xs text-[var(--text-muted)]">Cargando análisis...</p>
              ) : !a ? (
                <p className="text-xs text-[var(--text-muted)]">Este post aún no fue analizado con IA.</p>
              ) : (
                <div className="space-y-4">
                  {a.opening && (
                    <AnalysisSection title="Apertura" items={[
                      { label: "Qué se ve", value: a.opening.what_you_see },
                      { label: "Qué se dice", value: a.opening.what_is_said },
                      { label: "Texto en pantalla", value: a.opening.text_on_screen },
                      { label: "Cómo arranca", value: a.opening.how_it_starts },
                    ]} />
                  )}
                  {a.narrative && (
                    <AnalysisSection title="Narrativa" items={[
                      { label: "Historia completa", value: a.narrative.full_story },
                      { label: "Contenido hablado", value: a.narrative.spoken_content },
                      { label: "Textos en pantalla", value: a.narrative.text_on_screen_all },
                      { label: "Cierre", value: a.narrative.ending },
                    ]}>
                      {a.narrative.structure_segments && (
                        <div className="mt-2">
                          <p className="text-[10px] uppercase text-[var(--text-muted)] mb-1">Segmentos</p>
                          <div className="space-y-1.5">
                            {(Array.isArray(a.narrative.structure_segments) ? a.narrative.structure_segments : []).map((seg: { duration_approx?: string; what_ocurrs_narratively?: string; what_you_see?: string }, i: number) => (
                              <div key={i} className="bg-[var(--bg-tertiary)] rounded px-2.5 py-1.5 text-xs">
                                <span className="text-indigo-400 font-mono">{seg.duration_approx}</span>
                                <p className="text-[var(--text-secondary)] mt-0.5">{seg.what_ocurrs_narratively || seg.what_you_see}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </AnalysisSection>
                  )}
                  {a.format && (
                    <AnalysisSection title="Formato" items={[
                      { label: "Estilo de grabación", value: a.format.recording_style },
                      { label: "Escenario", value: a.format.setting },
                      { label: "Persona en cámara", value: a.format.person_on_camera },
                      { label: "Cambios de escena", value: a.format.scene_changes },
                      { label: "Textos superpuestos", value: a.format.text_overlays },
                      { label: "Ritmo de edición", value: a.format.editing_rhythm },
                    ]} />
                  )}
                  {a.audio && (
                    <AnalysisSection title="Audio" items={[
                      { label: "Voz", value: a.audio.voice },
                      { label: "Música", value: a.audio.music },
                      { label: "Efectos", value: a.audio.sound_effects },
                    ]} />
                  )}
                  {a.metadata && (
                    <div className="flex gap-2 flex-wrap">
                      {a.metadata.language && <span className="px-2 py-0.5 text-[10px] rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-muted)]">{a.metadata.language.toUpperCase()}</span>}
                      {a.metadata.category && <span className="px-2 py-0.5 text-[10px] rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-muted)]">{a.metadata.category}</span>}
                      {a.metadata.production_level && <span className={`px-2 py-0.5 text-[10px] rounded border ${
                        a.metadata.production_level === "high" ? "border-green-500/30 text-green-400 bg-green-500/10" :
                        a.metadata.production_level === "medium" ? "border-yellow-500/30 text-yellow-400 bg-yellow-500/10" :
                        "border-[var(--border)] text-[var(--text-muted)] bg-[var(--bg-tertiary)]"
                      }`}>Producción: {a.metadata.production_level}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisSection({ title, items, children }: {
  title: string;
  items: { label: string; value: string | string[] | null | undefined }[];
  children?: React.ReactNode;
}) {
  const visible = items.filter(i => i.value && i.value !== "not provided");
  if (visible.length === 0 && !children) return null;
  return (
    <div>
      <p className="text-[10px] uppercase text-indigo-400/70 font-semibold mb-2 tracking-wider">{title}</p>
      <div className="space-y-2">
        {visible.map(item => (
          <div key={item.label}>
            <p className="text-[10px] text-[var(--text-muted)] mb-0.5">{item.label}</p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {Array.isArray(item.value) ? item.value.join(", ") : item.value}
            </p>
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}

function AiStatusBadge({ status }: { status: string }) {
  if (status === "finished" || status === "completed") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-500/15 text-green-400 border-green-500/30">Analizado</span>;
  }
  if (status === "analyzing") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">Analizando...</span>;
  }
  if (status.startsWith("error")) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/15 text-red-400 border-red-500/30">Error</span>;
  }
  return <span className="text-[10px] text-[var(--text-muted)]">{"\u2014"}</span>;
}
