"use client";

import { Account, Post, Research } from "../lib/db";
import { createClient } from "../lib/supabase/browser";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

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

interface DashboardProps {
  accounts: Account[];
  posts: Post[];
  stats: {
    totalPosts: number;
    totalVideos: number;
    avgEngagement: number;
    avgViews: number;
    totalAccounts: number;
  };
  total: number;
  currentPage: number;
  pageSize: number;
  filters: {
    accountId?: number;
    researchId?: number;
    type: string;
    sortBy: string;
    sortDir: string;
  };
  researches: Research[];
  userEmail?: string;
}

export function Dashboard({
  accounts,
  posts,
  stats,
  total,
  currentPage,
  pageSize,
  filters,
  researches,
  userEmail,
}: DashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all" && value !== "1") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      if (key !== "page") params.delete("page");
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

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

        {/* Navigation */}
        <nav className="p-3 border-b border-[var(--border)] flex flex-col gap-1">
          <Link
            href="/"
            className="px-2 py-1.5 rounded text-sm bg-indigo-500/15 text-indigo-400 transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/researches"
            className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Investigaciones
          </Link>
        </nav>

        {/* Research filter */}
        {researches.length > 0 && (
          <div className="p-3 border-b border-[var(--border)]">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-semibold">
              Investigación
            </p>
            <button
              onClick={() => updateParam("research", undefined)}
              className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors mb-1 ${
                !filters.researchId
                  ? "bg-indigo-500/15 text-indigo-400"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              Todas
            </button>
            {researches.map((r) => (
              <button
                key={r.id}
                onClick={() => updateParam("research", String(r.id))}
                className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors truncate ${
                  filters.researchId === r.id
                    ? "bg-indigo-500/15 text-indigo-400"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
                title={`${r.name} — ${r.accounts_count} cuentas`}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="p-3 border-b border-[var(--border)]">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-semibold">
            Tipo
          </p>
          {["all", "Video", "Image", "Sidecar"].map((t) => (
            <button
              key={t}
              onClick={() => updateParam("type", t)}
              className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                filters.type === t
                  ? "bg-indigo-500/15 text-indigo-400"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {t === "all" ? "Todos" : t === "Video" ? "Reels" : t === "Sidecar" ? "Carouseles" : "Imágenes"}
            </button>
          ))}
        </div>

        {/* Account list */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-semibold">
            Cuentas ({stats.totalAccounts})
          </p>
          <button
            onClick={() => updateParam("account", undefined)}
            className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors mb-1 ${
              !filters.accountId
                ? "bg-indigo-500/15 text-indigo-400"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            Todas
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => updateParam("account", String(a.id))}
              className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors truncate ${
                filters.accountId === a.id
                  ? "bg-indigo-500/15 text-indigo-400"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
              title={`@${a.username} — ${formatNumber(a.followers_count)} followers`}
            >
              @{a.username}
            </button>
          ))}
        </div>

        {/* User */}
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
        <div className="flex items-center gap-6 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <StatCard label="Posts" value={formatNumber(stats.totalPosts)} />
          <StatCard label="Reels" value={formatNumber(stats.totalVideos)} />
          <StatCard
            label="Engagement promedio"
            value={formatPercent(stats.avgEngagement)}
            color={engagementColor(stats.avgEngagement)}
          />
          <StatCard label="Views promedio" value={formatNumber(stats.avgViews)} />
          <div className="ml-auto text-xs text-[var(--text-muted)]">
            {total} resultados
            {totalPages > 1 && ` — pág ${currentPage}/${totalPages}`}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium w-8">#</th>
                <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium min-w-[300px]">Post</th>
                <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">Cuenta</th>
                <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">Tipo</th>
                <SortHeader col="video_view_count" label="Views" current={filters.sortBy} icon={sortIcon} onClick={toggleSort} />
                <SortHeader col="likes_count" label="Likes" current={filters.sortBy} icon={sortIcon} onClick={toggleSort} />
                <SortHeader col="comments_count" label="Comments" current={filters.sortBy} icon={sortIcon} onClick={toggleSort} />
                <SortHeader col="shares_count" label="Shares" current={filters.sortBy} icon={sortIcon} onClick={toggleSort} />
                <SortHeader col="engagement_rate" label="Eng. Rate" current={filters.sortBy} icon={sortIcon} onClick={toggleSort} />
                <SortHeader col="performance_score" label="Score" current={filters.sortBy} icon={sortIcon} onClick={toggleSort} />
                <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">Dur.</th>
                <SortHeader col="posted_at" label="Fecha" current={filters.sortBy} icon={sortIcon} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {posts.map((post, i) => {
                const rank = (currentPage - 1) * pageSize + i + 1;
                const tl = typeLabel(post.type);
                return (
                  <tr
                    key={post.id}
                    className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs">{rank}</td>
                    <td className="px-3 py-2.5">
                      <div className="min-w-0">
                        <button
                          onClick={() => setSelectedPost(post)}
                          className="text-[var(--text-primary)] truncate max-w-md leading-tight text-left hover:text-indigo-400 transition-colors cursor-pointer block"
                        >
                          {post.caption
                            ? post.caption.split("\n")[0].substring(0, 80)
                            : "Sin caption"}
                        </button>
                        {post.hashtags.length > 0 && (
                          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate max-w-md">
                            {post.hashtags.slice(0, 5).map((h) => `#${h}`).join(" ")}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)] text-xs">
                      @{post.username}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${tl.color}`}>
                        {tl.text}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">
                      {formatNumber(post.video_view_count)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">
                      {formatNumber(post.likes_count)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">
                      {formatNumber(post.comments_count)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)] tabular-nums">
                      {formatNumber(post.shares_count)}
                    </td>
                    <td className={`px-3 py-2.5 tabular-nums ${engagementColor(post.engagement_rate)}`}>
                      {formatPercent(post.engagement_rate)}
                    </td>
                    <td className={`px-3 py-2.5 tabular-nums ${scoreColor(post.performance_score)}`}>
                      {post.performance_score != null
                        ? (post.performance_score * 100).toFixed(1)
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs tabular-nums">
                      {formatDuration(post.video_duration)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs tabular-nums">
                      {timeAgo(post.posted_at)}
                    </td>
                  </tr>
                );
              })}
              {posts.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-12 text-center text-[var(--text-muted)]">
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
            {currentPage > 1 && (
              <PageButton page={currentPage - 1} label="← Anterior" />
            )}
            <span className="text-xs text-[var(--text-muted)] px-3">
              {currentPage} / {totalPages}
            </span>
            {currentPage < totalPages && (
              <PageButton page={currentPage + 1} label="Siguiente →" />
            )}
          </div>
        )}
      </main>

      {/* Video Modal */}
      {selectedPost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setSelectedPost(null)}
        >
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <div>
                <p className="text-sm text-[var(--text-secondary)]">@{selectedPost.username}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {selectedPost.type} &middot; {formatDuration(selectedPost.video_duration)}
                </p>
              </div>
              <button
                onClick={() => setSelectedPost(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl px-2"
              >
                &times;
              </button>
            </div>

            {/* Video */}
            {selectedPost.stored_url ? (
              <div className="bg-black">
                <video
                  src={selectedPost.stored_url}
                  controls
                  autoPlay
                  className="w-full max-h-[60vh] object-contain"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-sm">
                Video no disponible en storage
              </div>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-4 gap-3 p-4 border-b border-[var(--border)]">
              <div>
                <p className="text-[10px] uppercase text-[var(--text-muted)]">Views</p>
                <p className="text-sm font-semibold">{formatNumber(selectedPost.video_view_count)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[var(--text-muted)]">Likes</p>
                <p className="text-sm font-semibold">{formatNumber(selectedPost.likes_count)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[var(--text-muted)]">Comments</p>
                <p className="text-sm font-semibold">{formatNumber(selectedPost.comments_count)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[var(--text-muted)]">Shares</p>
                <p className="text-sm font-semibold">{formatNumber(selectedPost.shares_count)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[var(--text-muted)]">Eng. Rate</p>
                <p className={`text-sm font-semibold ${engagementColor(selectedPost.engagement_rate)}`}>
                  {formatPercent(selectedPost.engagement_rate)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[var(--text-muted)]">Score</p>
                <p className={`text-sm font-semibold ${scoreColor(selectedPost.performance_score)}`}>
                  {selectedPost.performance_score != null
                    ? (selectedPost.performance_score * 100).toFixed(1)
                    : "—"}
                </p>
              </div>
            </div>

            {/* Caption */}
            {selectedPost.caption && (
              <div className="p-4">
                <p className="text-[10px] uppercase text-[var(--text-muted)] mb-1">Caption</p>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                  {selectedPost.caption}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`text-lg font-semibold ${color || "text-[var(--text-primary)]"}`}>{value}</p>
    </div>
  );
}

function SortHeader({
  col,
  label,
  current,
  icon,
  onClick,
}: {
  col: string;
  label: string;
  current: string;
  icon: (col: string) => string;
  onClick: (col: string) => void;
}) {
  return (
    <th
      className={`text-left px-3 py-2 font-medium cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors ${
        current === col ? "text-indigo-400" : "text-[var(--text-muted)]"
      }`}
      onClick={() => onClick(col)}
    >
      {label}{" "}
      <span className="text-[10px]">{icon(col)}</span>
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
        if (page > 1) {
          params.set("page", String(page));
        } else {
          params.delete("page");
        }
        router.push(`?${params.toString()}`);
      }}
      className="px-3 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
    >
      {label}
    </button>
  );
}
