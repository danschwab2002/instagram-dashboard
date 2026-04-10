"use client";

import { useState } from "react";
import type { IgMedia, IgStorySnapshot } from "../../lib/db";

function formatNumber(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function timeAgo(date: string | null): string {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function timeRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expirada";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m restantes` : `${mins}m restantes`;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function groupByDay(stories: IgMedia[]): { date: string; label: string; stories: IgMedia[] }[] {
  const groups: Record<string, IgMedia[]> = {};
  for (const story of stories) {
    const day = story.published_at
      ? new Date(story.published_at).toISOString().split("T")[0]
      : "unknown";
    if (!groups[day]) groups[day] = [];
    groups[day].push(story);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, stories]) => ({
      date,
      label: formatDate(date),
      stories,
    }));
}

interface Props {
  activeStories: IgMedia[];
  historicalStories: IgMedia[];
}

export function StoriesView({ activeStories, historicalStories }: Props) {
  const [selectedStory, setSelectedStory] = useState<IgMedia | null>(null);
  const [snapshots, setSnapshots] = useState<IgStorySnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  const historicalGroups = groupByDay(historicalStories);

  async function openStoryDetail(story: IgMedia) {
    setSelectedStory(story);
    setSnapshotsLoading(true);
    try {
      const res = await fetch(`/api/ig/stories/${story.id}/snapshots`);
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.snapshots);
      }
    } finally {
      setSnapshotsLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Active Stories */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            Historias activas
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            ({activeStories.length})
          </span>
        </div>

        {activeStories.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No hay historias activas en este momento.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeStories.map((story) => (
              <ActiveStoryCard
                key={story.id}
                story={story}
                onClick={() => openStoryDetail(story)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Historical Stories */}
      {historicalGroups.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-[var(--text-primary)] mb-4">
            Historial de historias
          </h2>
          <div className="space-y-6">
            {historicalGroups.map((group) => (
              <div key={group.date}>
                <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">
                  {group.label}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {group.stories.map((story) => (
                    <HistoricalStoryCard
                      key={story.id}
                      story={story}
                      onClick={() => openStoryDetail(story)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Story Detail Modal */}
      {selectedStory && (
        <StoryDetailModal
          story={selectedStory}
          snapshots={snapshots}
          loading={snapshotsLoading}
          onClose={() => {
            setSelectedStory(null);
            setSnapshots([]);
          }}
        />
      )}
    </div>
  );
}

function ActiveStoryCard({ story, onClick }: { story: IgMedia; onClick: () => void }) {
  return (
    <div
      className="rounded-lg border border-indigo-500/30 bg-[var(--bg-secondary)] overflow-hidden cursor-pointer hover:border-indigo-500/60 transition group"
      onClick={onClick}
    >
      {/* Preview */}
      <div className="relative h-48 bg-black">
        {story.media_url ? (
          story.media_type === "VIDEO" ? (
            <video
              src={story.stored_url || story.media_url}
              className="w-full h-full object-cover"
              muted
            />
          ) : (
            <img
              src={story.media_url}
              alt=""
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
            Sin preview
          </div>
        )}
        {/* Timer badge */}
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/40 text-[10px] text-green-400 font-medium">
          {timeRemaining(story.story_expires_at)}
        </div>
        {/* Type badge */}
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white">
          {story.media_type === "VIDEO" ? "Video" : "Foto"}
        </div>
      </div>

      {/* Metrics */}
      <div className="p-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          <MetricMini label="Alcance" value={story.reach} />
          <MetricMini label="Views" value={story.views} />
          <MetricMini label="Replies" value={story.replies} />
          <MetricMini label="Shares" value={story.shares} />
        </div>
        <div className="grid grid-cols-4 gap-2 text-center mt-2">
          <MetricMini label="Interact." value={story.total_interactions} />
          <MetricMini label="Follows" value={story.follows} />
          <MetricMini label="Fwd" value={story.navigation_tap_forward} />
          <MetricMini label="Exit" value={story.navigation_tap_exit} />
        </div>
        <div className="text-[10px] text-[var(--text-muted)] mt-2 text-right">
          Publicada hace {timeAgo(story.published_at)}
        </div>
      </div>
    </div>
  );
}

function HistoricalStoryCard({ story, onClick }: { story: IgMedia; onClick: () => void }) {
  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden cursor-pointer hover:border-[var(--text-muted)] transition"
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="relative h-32 bg-black">
        {story.thumbnail_url || story.media_url ? (
          <img
            src={story.thumbnail_url || story.media_url || ""}
            alt=""
            className="w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xs">
            Sin preview
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 px-1 py-0.5 rounded bg-black/60 text-[9px] text-white">
          {story.media_type === "VIDEO" ? "Video" : "Foto"}
        </div>
      </div>

      {/* Compact metrics */}
      <div className="p-2">
        <div className="grid grid-cols-3 gap-1 text-center">
          <MetricMini label="Alcance" value={story.reach} small />
          <MetricMini label="Views" value={story.views} small />
          <MetricMini label="Interact." value={story.total_interactions} small />
        </div>
        <div className="text-[9px] text-[var(--text-muted)] mt-1.5 text-right">
          {story.published_at
            ? new Date(story.published_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
            : "—"}
        </div>
      </div>
    </div>
  );
}

function MetricMini({ label, value, small }: { label: string; value: number | null; small?: boolean }) {
  return (
    <div>
      <div className={`${small ? "text-[9px]" : "text-[10px]"} text-[var(--text-muted)]`}>{label}</div>
      <div className={`${small ? "text-xs" : "text-sm"} font-semibold text-[var(--text-primary)]`}>
        {formatNumber(value)}
      </div>
    </div>
  );
}

function StoryDetailModal({
  story,
  snapshots,
  loading,
  onClose,
}: {
  story: IgMedia;
  snapshots: IgStorySnapshot[];
  loading: boolean;
  onClose: () => void;
}) {
  const [chartMetric, setChartMetric] = useState<string>("reach");

  const CHART_METRICS = [
    { key: "reach", label: "Alcance" },
    { key: "views", label: "Views" },
    { key: "impressions", label: "Impresiones" },
    { key: "replies", label: "Respuestas" },
    { key: "shares", label: "Compartidos" },
    { key: "total_interactions", label: "Interacciones" },
    { key: "follows", label: "Follows" },
  ];

  const chartData = snapshots.map((s) => ({
    time: new Date(s.synced_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
    value: (s as unknown as Record<string, number>)[chartMetric] || 0,
  }));

  const maxVal = Math.max(...chartData.map((d) => d.value), 1);
  const yMax = Math.ceil(maxVal * 1.2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <span className="text-xs px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
              Story
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {story.published_at ? new Date(story.published_at).toLocaleString("es-AR") : "—"}
            </span>
            {!story.is_story_expired && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/40">
                {timeRemaining(story.story_expires_at)}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl px-2">
            ×
          </button>
        </div>

        {/* Media preview */}
        {(story.stored_url || story.media_url) && (
          <div className="bg-black max-h-[40vh] flex items-center justify-center">
            {story.media_type === "VIDEO" ? (
              <video
                src={story.stored_url || story.media_url!}
                controls
                autoPlay
                className="max-h-[40vh] object-contain"
              />
            ) : (
              <img
                src={story.media_url!}
                alt=""
                className="max-h-[40vh] object-contain"
              />
            )}
          </div>
        )}

        {/* Metrics grid */}
        <div className="grid grid-cols-4 gap-3 p-4 border-b border-[var(--border)]">
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Alcance</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.reach)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Views</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.views)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Impresiones</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.impressions)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Respuestas</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.replies)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Compartidos</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.shares)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Interacciones</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.total_interactions)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Follows</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.follows)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Visitas perfil</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.profile_visits)}</p></div>
        </div>

        {/* Navigation breakdown */}
        <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-[var(--border)]">
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Tap adelante</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.navigation_tap_forward)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Tap atras</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.navigation_tap_back)}</p></div>
          <div><p className="text-[10px] uppercase text-[var(--text-muted)]">Salida</p><p className="text-sm font-semibold text-[var(--text-primary)]">{formatNumber(story.navigation_tap_exit)}</p></div>
        </div>

        {/* Evolution chart */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-[var(--text-primary)]">Evolucion de metricas</h3>
            <select
              value={chartMetric}
              onChange={(e) => setChartMetric(e.target.value)}
              className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
            >
              {CHART_METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="text-center text-xs text-[var(--text-muted)] py-8">Cargando snapshots...</div>
          ) : chartData.length === 0 ? (
            <div className="text-center text-xs text-[var(--text-muted)] py-8">
              Sin datos de evolucion todavia. Los snapshots se acumulan cada 20 minutos.
            </div>
          ) : (
            <div className="relative h-40">
              {/* Y axis */}
              <div className="absolute left-0 top-0 bottom-5 w-10 flex flex-col justify-between text-right pr-1">
                <span className="text-[9px] text-[var(--text-muted)]">{formatNumber(yMax)}</span>
                <span className="text-[9px] text-[var(--text-muted)]">0</span>
              </div>

              {/* Bars + line */}
              <div className="ml-12 h-[calc(100%-1.25rem)] relative">
                <div className="h-full flex gap-[1px]">
                  {chartData.map((d, i) => {
                    const height = yMax > 0 ? (d.value / yMax) * 100 : 0;
                    return (
                      <div key={i} className="flex-1 flex flex-col justify-end items-center group relative">
                        <div
                          className="w-full bg-indigo-500/40 hover:bg-indigo-500/70 rounded-t transition-all cursor-pointer"
                          style={{ height: `${Math.max(height, 1)}%` }}
                        />
                        <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                          <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-lg">
                            <div className="text-[var(--text-primary)] font-medium">{formatNumber(d.value)}</div>
                            <div className="text-[var(--text-muted)]">{d.time}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Trend line */}
                {chartData.length >= 2 && (
                  <svg
                    className="absolute inset-0 pointer-events-none"
                    viewBox={`0 0 ${chartData.length * 100} 100`}
                    preserveAspectRatio="none"
                  >
                    <path
                      d={(() => {
                        const pts = chartData.map((d, i) => ({
                          x: (i + 0.5) * 100,
                          y: yMax > 0 ? 100 - (d.value / yMax) * 100 : 100,
                        }));
                        if (pts.length === 2) {
                          return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
                        }
                        let path = `M ${pts[0].x} ${pts[0].y}`;
                        for (let i = 0; i < pts.length - 1; i++) {
                          const p0 = pts[Math.max(i - 1, 0)];
                          const p1 = pts[i];
                          const p2 = pts[i + 1];
                          const p3 = pts[Math.min(i + 2, pts.length - 1)];
                          const cp1x = p1.x + (p2.x - p0.x) / 6;
                          const cp1y = p1.y + (p2.y - p0.y) / 6;
                          const cp2x = p2.x - (p3.x - p1.x) / 6;
                          const cp2y = p2.y - (p3.y - p1.y) / 6;
                          path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
                        }
                        return path;
                      })()}
                      fill="none"
                      stroke="rgb(129, 140, 248)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                    {chartData.map((d, i) => (
                      <circle
                        key={i}
                        cx={(i + 0.5) * 100}
                        cy={yMax > 0 ? 100 - (d.value / yMax) * 100 : 100}
                        r="3"
                        fill="rgb(129, 140, 248)"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                )}
              </div>

              {/* X axis */}
              <div className="ml-12 flex gap-[1px] mt-0.5">
                {chartData.map((d, i) => {
                  const show = chartData.length <= 12 || i % Math.ceil(chartData.length / 8) === 0 || i === chartData.length - 1;
                  return (
                    <div key={i} className="flex-1 text-center">
                      <span className="text-[8px] text-[var(--text-muted)]">{show ? d.time : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Link to Instagram */}
        {story.permalink && (
          <div className="px-4 pb-4">
            <a href={story.permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300">
              Ver en Instagram →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
