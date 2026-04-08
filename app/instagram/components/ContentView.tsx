"use client";

import { useState } from "react";
import type { IgMedia } from "../../lib/db";

function formatNumber(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const seconds = ms / 1000;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function timeAgo(date: string | null): string {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}sem`;
  return `${Math.floor(days / 30)}m`;
}

function typeLabel(type: string | null): { text: string; color: string } {
  switch (type) {
    case "REELS":
      return { text: "Reel", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" };
    case "FEED":
      return { text: "Post", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "STORY":
      return { text: "Story", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    default:
      return { text: type || "—", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" };
  }
}

interface Props {
  media: IgMedia[];
  total: number;
  connectionId: number;
}

type SortKey = "published_at" | "reach" | "views" | "like_count" | "saves" | "shares" | "total_interactions" | "ig_reels_avg_watch_time";

export function ContentView({ media, total, connectionId }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>("published_at");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");
  const [selectedMedia, setSelectedMedia] = useState<IgMedia | null>(null);

  // Client-side sort for now (all data loaded)
  const sorted = [...media].sort((a, b) => {
    const aVal = (a[sortBy] as number | null) ?? 0;
    const bVal = (b[sortBy] as number | null) ?? 0;
    return sortDir === "DESC" ? bVal - aVal : aVal - bVal;
  });

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === "DESC" ? "ASC" : "DESC");
    } else {
      setSortBy(key);
      setSortDir("DESC");
    }
  }

  function SortHeader({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const isActive = sortBy === sortKey;
    return (
      <th
        className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] select-none"
        onClick={() => toggleSort(sortKey)}
      >
        {label} {isActive ? (sortDir === "DESC" ? "↓" : "↑") : "↕"}
      </th>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          {total} publicaciones
        </h2>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-secondary)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)] w-8">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Post</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Tipo</th>
                <SortHeader label="Views" sortKey="views" />
                <SortHeader label="Reach" sortKey="reach" />
                <SortHeader label="Likes" sortKey="like_count" />
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Comm.</th>
                <SortHeader label="Saves" sortKey="saves" />
                <SortHeader label="Shares" sortKey="shares" />
                <SortHeader label="Interact." sortKey="total_interactions" />
                <SortHeader label="Avg Watch" sortKey="ig_reels_avg_watch_time" />
                <SortHeader label="Fecha" sortKey="published_at" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sorted.map((item, idx) => {
                const tt = typeLabel(item.media_product_type);
                return (
                  <tr
                    key={item.id}
                    className="hover:bg-white/[0.02] cursor-pointer transition"
                    onClick={() => setSelectedMedia(item)}
                  >
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{idx + 1}</td>
                    <td className="px-3 py-2 max-w-[250px]">
                      <div className="text-xs text-[var(--text-primary)] truncate">
                        {item.caption?.slice(0, 80) || "Sin caption"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tt.color}`}>
                        {tt.text}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)]">{formatNumber(item.views)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)]">{formatNumber(item.reach)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)]">{formatNumber(item.like_count)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)]">{formatNumber(item.comments_count)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)]">{formatNumber(item.saves)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)]">{formatNumber(item.shares)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)] font-medium">
                      {formatNumber(item.total_interactions)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-primary)]">
                      {formatDuration(item.ig_reels_avg_watch_time)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      {timeAgo(item.published_at)}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-12 text-center text-[var(--text-muted)]">
                    No hay publicaciones cargadas. Ejecuta la carga historica desde n8n.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de detalle */}
      {selectedMedia && (
        <MediaModal media={selectedMedia} onClose={() => setSelectedMedia(null)} />
      )}
    </div>
  );
}

function MediaModal({ media, onClose }: { media: IgMedia; onClose: () => void }) {
  const tt = typeLabel(media.media_product_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded border ${tt.color}`}>{tt.text}</span>
            <span className="text-xs text-[var(--text-muted)]">
              {media.published_at ? new Date(media.published_at).toLocaleDateString("es-AR") : "—"}
            </span>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Caption */}
          {media.caption && (
            <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
              {media.caption}
            </p>
          )}

          {/* Metrics grid */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Views" value={media.views} />
            <MetricCard label="Reach" value={media.reach} />
            <MetricCard label="Likes" value={media.like_count} />
            <MetricCard label="Comentarios" value={media.comments_count} />
            <MetricCard label="Guardados" value={media.saves} />
            <MetricCard label="Compartidos" value={media.shares} />
            <MetricCard label="Interacciones totales" value={media.total_interactions} />
            <MetricCard label="Follows" value={media.follows} />
            <MetricCard label="Visitas al perfil" value={media.profile_visits} />
          </div>

          {/* Reel-specific */}
          {media.media_product_type === "REELS" && (
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label="Tiempo prom. de visualizacion"
                value={null}
                displayValue={formatDuration(media.ig_reels_avg_watch_time)}
              />
              <MetricCard
                label="Skip rate"
                value={null}
                displayValue={media.skip_rate != null ? (media.skip_rate * 100).toFixed(1) + "%" : "—"}
              />
            </div>
          )}

          {/* Link to Instagram */}
          {media.permalink && (
            <a
              href={media.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-indigo-400 hover:text-indigo-300"
            >
              Ver en Instagram →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  displayValue,
}: {
  label: string;
  value: number | null;
  displayValue?: string;
}) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
      <div className="text-[10px] text-[var(--text-muted)] mb-1">{label}</div>
      <div className="text-lg font-semibold text-[var(--text-primary)]">
        {displayValue ?? formatNumber(value)}
      </div>
    </div>
  );
}
