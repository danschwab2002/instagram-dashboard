"use client";

import { Account, Post, Research, PostFilters, Stats } from "../lib/db";
import { createClient } from "../lib/supabase/browser";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useMemo, useRef, useEffect } from "react";

// ── Helpers ──────────────────────────────────────────────

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatPercent(n: number | null | undefined): string {
  if (n == null) return "—";
  return (n * 100).toFixed(2) + "%";
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
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

function typeLabel(type: string): { text: string; color: string } {
  switch (type) {
    case "Video":
      return { text: "Reel", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
    case "Sidecar":
      return { text: "Carousel", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
    default:
      return { text: "Image", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" };
  }
}

// ── Filter definitions ───────────────────────────────────

type FilterDef =
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "multiselect"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "range"; keyMin: string; keyMax: string; placeholder?: [string, string] }
  | { key: string; label: string; type: "text"; paramKey: string; placeholder: string }
  | { key: string; label: string; type: "daterange"; keyFrom: string; keyTo: string };

// ── Column definitions ───────────────────────────────────

const ALL_COLUMNS = [
  { key: "rank", label: "#", default: true },
  { key: "caption", label: "Post", default: true },
  { key: "username", label: "Cuenta", default: true },
  { key: "owner", label: "Owner", default: true },
  { key: "type", label: "Tipo", default: true },
  { key: "views", label: "Views", default: true, sortKey: "video_view_count" },
  { key: "likes", label: "Likes", default: true, sortKey: "likes_count" },
  { key: "comments", label: "Comments", default: true, sortKey: "comments_count" },
  { key: "shares", label: "Shares", default: false, sortKey: "shares_count" },
  { key: "engagement", label: "Eng. Rate", default: true, sortKey: "engagement_rate" },
  { key: "score", label: "Score", default: true, sortKey: "performance_score" },
  { key: "duration", label: "Dur.", default: true, sortKey: "video_duration" },
  { key: "date", label: "Fecha", default: true, sortKey: "posted_at" },
  { key: "scraped_at", label: "Scrapeado", default: false },
  { key: "ai_status", label: "IA", default: true },
];

// ── Main Component ───────────────────────────────────────

interface DashboardProps {
  accounts: Account[];
  posts: Post[];
  stats: Stats;
  total: number;
  currentPage: number;
  pageSize: number;
  filters: PostFilters;
  researches: Research[];
  owners: string[];
  userEmail?: string;
}

export function Dashboard({
  accounts, posts, stats, total, currentPage, pageSize, filters, researches, owners, userEmail,
}: DashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key))
  );

  // Count active filters (excluding sort/page/limit)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.researchId) count++;
    if (filters.accountIds?.length) count++;
    if (filters.ownerEmail) count++;
    if (filters.type && filters.type !== "all") count++;
    if (filters.captionSearch) count++;
    if (filters.hashtag) count++;
    if (filters.viewsMin != null || filters.viewsMax != null) count++;
    if (filters.likesMin != null || filters.likesMax != null) count++;
    if (filters.commentsMin != null || filters.commentsMax != null) count++;
    if (filters.engagementMin != null || filters.engagementMax != null) count++;
    if (filters.scoreMin != null || filters.scoreMax != null) count++;
    if (filters.durationMin != null || filters.durationMax != null) count++;
    if (filters.dateFrom || filters.dateTo) count++;
    return count;
  }, [filters]);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      params.delete("page");
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const clearAllFilters = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.sortBy !== "performance_score") params.set("sort", filters.sortBy!);
    if (filters.sortDir !== "DESC") params.set("dir", filters.sortDir!);
    router.push(`?${params.toString()}`);
  }, [router, filters]);

  const toggleSort = useCallback(
    (column: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (filters.sortBy === column) {
        params.set("dir", filters.sortDir === "DESC" ? "ASC" : "DESC");
      } else {
        params.set("sort", column);
        params.set("dir", "DESC");
      }
      params.delete("page");
      router.push(`?${params.toString()}`);
    },
    [router, searchParams, filters]
  );

  const totalPages = Math.ceil(total / pageSize);
  const sortIcon = (col: string) => {
    if (filters.sortBy !== col) return "↕";
    return filters.sortDir === "DESC" ? "↓" : "↑";
  };

  const [selectingAll, setSelectingAll] = useState(false);

  const toggleSelectAll = async () => {
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
      return;
    }
    // If total fits in one page, just select what we have
    if (total <= pageSize) {
      setSelectedIds(new Set(posts.map(p => p.id)));
      return;
    }
    // Otherwise, fetch ALL matching IDs from the API
    setSelectingAll(true);
    try {
      const res = await fetch(`/api/posts/ids?${searchParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedIds(new Set(data.ids));
      }
    } finally {
      setSelectingAll(false);
    }
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleColumn = (key: string) => {
    const next = new Set(visibleCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisibleCols(next);
  };

  // Build filter definitions based on available data
  const filterDefs: FilterDef[] = [
    {
      key: "research", label: "Investigación", type: "select",
      options: [{ value: "", label: "Todas" }, ...researches.map(r => ({ value: String(r.id), label: r.name }))],
    },
    {
      key: "accounts", label: "Creadores", type: "multiselect",
      options: accounts.map(a => ({ value: String(a.id), label: `@${a.username}` })),
    },
    {
      key: "owner", label: "Owner", type: "select",
      options: [{ value: "", label: "Todos" }, ...owners.map(o => ({ value: o, label: o.split("@")[0] }))],
    },
    {
      key: "type", label: "Tipo", type: "select",
      options: [{ value: "all", label: "Todos" }, { value: "Video", label: "Reel" }, { value: "Sidecar", label: "Carousel" }, { value: "Image", label: "Image" }],
    },
    { key: "views", label: "Views", type: "range", keyMin: "viewsMin", keyMax: "viewsMax", placeholder: ["Min", "Max"] },
    { key: "likes", label: "Likes", type: "range", keyMin: "likesMin", keyMax: "likesMax", placeholder: ["Min", "Max"] },
    { key: "comments", label: "Comments", type: "range", keyMin: "commentsMin", keyMax: "commentsMax", placeholder: ["Min", "Max"] },
    { key: "engagement", label: "Eng. Rate", type: "range", keyMin: "engMin", keyMax: "engMax", placeholder: ["Min %", "Max %"] },
    { key: "score", label: "Score", type: "range", keyMin: "scoreMin", keyMax: "scoreMax", placeholder: ["Min", "Max"] },
    { key: "duration", label: "Duración (s)", type: "range", keyMin: "durMin", keyMax: "durMax", placeholder: ["Min seg", "Max seg"] },
    { key: "date", label: "Fecha", type: "daterange", keyFrom: "dateFrom", keyTo: "dateTo" },
    { key: "caption", label: "Caption", type: "text", paramKey: "caption", placeholder: "Buscar en caption..." },
    { key: "hashtag", label: "Hashtag", type: "text", paramKey: "hashtag", placeholder: "Ej: ai, claudecode..." },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — minimal, just nav */}
      <aside className="w-48 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-sm font-bold tracking-wide text-indigo-400 uppercase">Antigravity</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Content Dashboard</p>
        </div>
        <nav className="p-3 flex flex-col gap-1">
          <Link href="/" className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400">Dashboard</Link>
          <Link href="/researches" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Investigaciones</Link>
          <Link href="/settings" className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Configuración</Link>
        </nav>
        {userEmail && (
          <div className="p-3 border-t border-[var(--border)] mt-auto">
            <p className="text-xs text-[var(--text-muted)] truncate mb-1">{userEmail}</p>
            <button
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                router.push("/login");
                router.refresh();
              }}
              className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Stats bar */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)] overflow-x-auto">
          <StatCard label="Posts" value={formatNumber(stats.totalPosts)} />
          <StatCard label="Reels" value={formatNumber(stats.totalVideos)} />
          <StatGroup
            label="Views"
            avg={formatNumber(stats.avgViews)}
            min={formatNumber(stats.minViews)}
            max={formatNumber(stats.maxViews)}
          />
          <StatGroup
            label="Likes"
            avg={formatNumber(stats.avgLikes)}
            min={formatNumber(stats.minLikes)}
            max={formatNumber(stats.maxLikes)}
          />
          <StatGroup
            label="Comments"
            avg={formatNumber(stats.avgComments)}
            min={formatNumber(stats.minComments)}
            max={formatNumber(stats.maxComments)}
          />
          <StatGroup
            label="Eng. Rate"
            avg={formatPercent(stats.avgEngagement)}
            min={formatPercent(stats.minEngagement)}
            max={formatPercent(stats.maxEngagement)}
            color={engagementColor(stats.avgEngagement)}
          />
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-xs text-[var(--text-muted)]">
              {total} resultados{totalPages > 1 && ` — pág ${currentPage}/${totalPages}`}
            </span>
          </div>
        </div>

        {/* Filter toolbar */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              activeFilterCount > 0
                ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            Filtros{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>
          <button
            onClick={() => setShowColumns(!showColumns)}
            className="px-2.5 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Columnas
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="px-2.5 py-1 text-xs text-red-400/70 hover:text-red-400 transition-colors"
            >
              Limpiar filtros
            </button>
          )}
          {selectedIds.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-indigo-400">{selectedIds.size} seleccionados</span>
              <button className="px-2.5 py-1 text-xs rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
                Analizar con IA
              </button>
            </div>
          )}
        </div>

        {/* Column visibility dropdown */}
        {showColumns && (
          <div className="px-5 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex flex-wrap gap-2">
            {ALL_COLUMNS.map(col => (
              <button
                key={col.key}
                onClick={() => toggleColumn(col.key)}
                className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                  visibleCols.has(col.key)
                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {col.label}
              </button>
            ))}
          </div>
        )}

        {/* Filter panel */}
        {showFilters && (
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)] grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filterDefs.map(fd => (
              <FilterControl key={fd.key} def={fd} searchParams={searchParams} updateParams={updateParams} />
            ))}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
              <tr>
                <th className="px-3 py-2 w-8">
                  {selectingAll ? (
                    <span className="text-[10px] text-[var(--text-muted)]">...</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0}
                      onChange={toggleSelectAll}
                      className="accent-indigo-500"
                    />
                  )}
                </th>
                {visibleCols.has("rank") && <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium w-8">#</th>}
                {visibleCols.has("caption") && <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium min-w-[250px]">Post</th>}
                {visibleCols.has("username") && <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">Cuenta</th>}
                {visibleCols.has("owner") && <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">Owner</th>}
                {visibleCols.has("type") && <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">Tipo</th>}
                {visibleCols.has("views") && <SortHeader col="video_view_count" label="Views" current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("likes") && <SortHeader col="likes_count" label="Likes" current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("comments") && <SortHeader col="comments_count" label="Comments" current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("shares") && <SortHeader col="shares_count" label="Shares" current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("engagement") && <SortHeader col="engagement_rate" label="Eng. Rate" current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("score") && <SortHeader col="performance_score" label="Score" current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("duration") && <SortHeader col="video_duration" label="Dur." current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("date") && <SortHeader col="posted_at" label="Fecha" current={filters.sortBy!} icon={sortIcon} onClick={toggleSort} />}
                {visibleCols.has("scraped_at") && <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">Scrapeado</th>}
                {visibleCols.has("ai_status") && <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">IA</th>}
              </tr>
            </thead>
            <tbody>
              {posts.map((post, i) => {
                const rank = (currentPage - 1) * pageSize + i + 1;
                const tl = typeLabel(post.type);
                const isSelected = selectedIds.has(post.id);
                return (
                  <tr
                    key={post.id}
                    className={`border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors ${isSelected ? "bg-indigo-500/5" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(post.id)} className="accent-indigo-500" />
                    </td>
                    {visibleCols.has("rank") && <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs">{rank}</td>}
                    {visibleCols.has("caption") && (
                      <td className="px-3 py-2.5">
                        <div className="min-w-0">
                          <button
                            onClick={() => setSelectedPost(post)}
                            className="text-[var(--text-primary)] truncate max-w-md leading-tight text-left hover:text-indigo-400 transition-colors cursor-pointer block"
                          >
                            {post.caption ? post.caption.split("\n")[0].substring(0, 80) : "Sin caption"}
                          </button>
                          {post.hashtags.length > 0 && (
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate max-w-md">
                              {post.hashtags.slice(0, 5).map(h => `#${h}`).join(" ")}
                            </p>
                          )}
                        </div>
                      </td>
                    )}
                    {visibleCols.has("username") && <td className="px-3 py-2.5 text-[var(--text-secondary)] text-xs">@{post.username}</td>}
                    {visibleCols.has("owner") && (
                      <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs truncate max-w-[120px]" title={post.owner_email || ""}>
                        {post.owner_email ? post.owner_email.split("@")[0] : "—"}
                      </td>
                    )}
                    {visibleCols.has("type") && (
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${tl.color}`}>{tl.text}</span>
                      </td>
                    )}
                    {visibleCols.has("views") && <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">{formatNumber(post.video_view_count)}</td>}
                    {visibleCols.has("likes") && <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">{formatNumber(post.likes_count)}</td>}
                    {visibleCols.has("comments") && <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">{formatNumber(post.comments_count)}</td>}
                    {visibleCols.has("shares") && <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">{formatNumber(post.shares_count)}</td>}
                    {visibleCols.has("engagement") && <td className={`px-3 py-2.5 tabular-nums ${engagementColor(post.engagement_rate)}`}>{formatPercent(post.engagement_rate)}</td>}
                    {visibleCols.has("score") && (
                      <td className={`px-3 py-2.5 tabular-nums ${scoreColor(post.performance_score)}`}>
                        {post.performance_score != null ? (post.performance_score * 100).toFixed(1) : "—"}
                      </td>
                    )}
                    {visibleCols.has("duration") && <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs tabular-nums">{formatDuration(post.video_duration)}</td>}
                    {visibleCols.has("date") && <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs tabular-nums">{timeAgo(post.posted_at)}</td>}
                    {visibleCols.has("scraped_at") && (
                      <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs tabular-nums">
                        {post.scraped_at ? timeAgo(post.scraped_at) : "—"}
                      </td>
                    )}
                    {visibleCols.has("ai_status") && (
                      <td className="px-3 py-2.5">
                        <AiStatusBadge status={post.analysis_status || "pending"} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {posts.length === 0 && (
                <tr>
                  <td colSpan={20} className="px-3 py-12 text-center text-[var(--text-muted)]">
                    No hay posts con los filtros seleccionados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-2 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
            {currentPage > 1 && <PageButton page={currentPage - 1} label="← Anterior" />}
            <span className="text-xs text-[var(--text-muted)] px-3">{currentPage} / {totalPages}</span>
            {currentPage < totalPages && <PageButton page={currentPage + 1} label="Siguiente →" />}
          </div>
        )}
      </main>

      {/* Video Modal */}
      {selectedPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setSelectedPost(null)}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <div>
                <p className="text-sm text-[var(--text-secondary)]">@{selectedPost.username}</p>
                <p className="text-xs text-[var(--text-muted)]">{selectedPost.type} · {formatDuration(selectedPost.video_duration)}</p>
              </div>
              <button onClick={() => setSelectedPost(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl px-2">×</button>
            </div>
            {selectedPost.stored_url ? (
              <div className="bg-black">
                <video src={selectedPost.stored_url} controls autoPlay className="w-full max-h-[60vh] object-contain" />
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-sm">Video no disponible</div>
            )}
            <div className="grid grid-cols-4 gap-3 p-4 border-b border-[var(--border)]">
              <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Views</p><p className="text-sm font-semibold">{formatNumber(selectedPost.video_view_count)}</p></div>
              <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Likes</p><p className="text-sm font-semibold">{formatNumber(selectedPost.likes_count)}</p></div>
              <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Comments</p><p className="text-sm font-semibold">{formatNumber(selectedPost.comments_count)}</p></div>
              <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Shares</p><p className="text-sm font-semibold">{formatNumber(selectedPost.shares_count)}</p></div>
              <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Eng. Rate</p><p className={`text-sm font-semibold ${engagementColor(selectedPost.engagement_rate)}`}>{formatPercent(selectedPost.engagement_rate)}</p></div>
              <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Score</p><p className={`text-sm font-semibold ${scoreColor(selectedPost.performance_score)}`}>{selectedPost.performance_score != null ? (selectedPost.performance_score * 100).toFixed(1) : "—"}</p></div>
            </div>
            {selectedPost.caption && (
              <div className="p-4">
                <p className="text-[10px] uppercase text-[var(--text-muted)] mb-1">Caption</p>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{selectedPost.caption}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter Control Component ─────────────────────────────

function FilterControl({
  def,
  searchParams,
  updateParams,
}: {
  def: FilterDef;
  searchParams: ReturnType<typeof useSearchParams>;
  updateParams: (updates: Record<string, string | undefined>) => void;
}) {
  if (def.type === "select") {
    const current = searchParams.get(def.key) || "";
    return (
      <div>
        <label className="block text-[10px] uppercase text-[var(--text-muted)] mb-1">{def.label}</label>
        <select
          value={current}
          onChange={e => updateParams({ [def.key]: e.target.value || undefined })}
          className="w-full px-2 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
        >
          {def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  if (def.type === "multiselect") {
    const current = new Set(searchParams.get(def.key)?.split(",").filter(Boolean) || []);
    const toggle = (val: string) => {
      const next = new Set(current);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      updateParams({ [def.key]: next.size > 0 ? Array.from(next).join(",") : undefined });
    };
    return (
      <div className="col-span-2">
        <label className="block text-[10px] uppercase text-[var(--text-muted)] mb-1">
          {def.label}{current.size > 0 && ` (${current.size})`}
        </label>
        <div className="flex flex-wrap gap-1">
          {def.options.map(o => (
            <button
              key={o.value}
              onClick={() => toggle(o.value)}
              className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                current.has(o.value)
                  ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-400"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (def.type === "range") {
    return (
      <div>
        <label className="block text-[10px] uppercase text-[var(--text-muted)] mb-1">{def.label}</label>
        <div className="flex gap-1">
          <DebouncedInput
            type="number"
            paramKey={def.keyMin}
            searchParams={searchParams}
            updateParams={updateParams}
            placeholder={def.placeholder?.[0] || "Min"}
            className="w-1/2 px-2 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500 tabular-nums"
          />
          <DebouncedInput
            type="number"
            paramKey={def.keyMax}
            searchParams={searchParams}
            updateParams={updateParams}
            placeholder={def.placeholder?.[1] || "Max"}
            className="w-1/2 px-2 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500 tabular-nums"
          />
        </div>
      </div>
    );
  }

  if (def.type === "daterange") {
    return (
      <div>
        <label className="block text-[10px] uppercase text-[var(--text-muted)] mb-1">{def.label}</label>
        <div className="flex gap-1">
          <DebouncedInput
            type="date"
            paramKey={def.keyFrom}
            searchParams={searchParams}
            updateParams={updateParams}
            className="w-1/2 px-2 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
          />
          <DebouncedInput
            type="date"
            paramKey={def.keyTo}
            searchParams={searchParams}
            updateParams={updateParams}
            className="w-1/2 px-2 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>
    );
  }

  if (def.type === "text") {
    return (
      <div>
        <label className="block text-[10px] uppercase text-[var(--text-muted)] mb-1">{def.label}</label>
        <DebouncedInput
          type="text"
          paramKey={def.paramKey}
          searchParams={searchParams}
          updateParams={updateParams}
          placeholder={def.placeholder}
          className="w-full px-2 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500"
        />
      </div>
    );
  }

  return null;
}

// ── Sub-components ───────────────────────────────────────

function DebouncedInput({
  paramKey,
  searchParams,
  updateParams,
  type = "text",
  placeholder,
  className,
}: {
  paramKey: string;
  searchParams: ReturnType<typeof useSearchParams>;
  updateParams: (updates: Record<string, string | undefined>) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  const urlValue = searchParams.get(paramKey) || "";
  const [local, setLocal] = useState(urlValue);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync from URL when it changes externally (e.g. "clear filters")
  useEffect(() => {
    setLocal(urlValue);
  }, [urlValue]);

  const handleChange = (val: string) => {
    setLocal(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateParams({ [paramKey]: val || undefined });
    }, 600);
  };

  return (
    <input
      type={type}
      value={local}
      onChange={e => handleChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="shrink-0">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`text-lg font-semibold ${color || "text-[var(--text-primary)]"}`}>{value}</p>
    </div>
  );
}

function StatGroup({ label, avg, min, max, color }: { label: string; avg: string; min: string; max: string; color?: string }) {
  return (
    <div className="shrink-0 border-l border-[var(--border)] pl-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`text-base font-semibold ${color || "text-[var(--text-primary)]"}`}>{avg}</p>
      <div className="flex gap-2 mt-0.5">
        <span className="text-[10px] text-[var(--text-muted)]">min <span className="text-[var(--text-secondary)]">{min}</span></span>
        <span className="text-[10px] text-[var(--text-muted)]">max <span className="text-[var(--text-secondary)]">{max}</span></span>
      </div>
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
  return <span className="text-[10px] text-[var(--text-muted)]">—</span>;
}

function SortHeader({ col, label, current, icon, onClick }: {
  col: string; label: string; current: string; icon: (col: string) => string; onClick: (col: string) => void;
}) {
  return (
    <th
      className={`text-left px-3 py-2 font-medium cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors ${
        current === col ? "text-indigo-400" : "text-[var(--text-muted)]"
      }`}
      onClick={() => onClick(col)}
    >
      {label} <span className="text-[10px]">{icon(col)}</span>
    </th>
  );
}

function PageButton({ page, label }: { page: number; label: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  return (
    <button
      onClick={() => {
        const params = new URLSearchParams(searchParams.toString());
        if (page > 1) params.set("page", String(page));
        else params.delete("page");
        router.push(`?${params.toString()}`);
      }}
      className="px-3 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
    >
      {label}
    </button>
  );
}
