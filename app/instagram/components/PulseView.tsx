"use client";

import { useMemo, useState } from "react";
import type { IgPulseStats, IgDailyMetrics, IgConnection } from "../../lib/db";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function deltaPercent(current: number, previous: number): { value: number; label: string; positive: boolean } {
  if (previous === 0) return { value: 0, label: "—", positive: true };
  const pct = ((current - previous) / previous) * 100;
  return {
    value: pct,
    label: (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%",
    positive: pct >= 0,
  };
}

const METRIC_OPTIONS = [
  { key: "reach", label: "Alcance" },
  { key: "views", label: "Views" },
  { key: "total_interactions", label: "Interacciones" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comentarios" },
  { key: "shares", label: "Compartidos" },
  { key: "saves", label: "Guardados" },
  { key: "follows_net", label: "Seguidores netos" },
] as const;

const RANGE_OPTIONS = [
  { days: 7, label: "7d" },
  { days: 15, label: "15d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 180, label: "180d" },
] as const;

type MetricKey = (typeof METRIC_OPTIONS)[number]["key"];

interface Props {
  stats: IgPulseStats;
  dailyMetrics: IgDailyMetrics[];
  connection: IgConnection;
}

export function PulseView({ stats, dailyMetrics, connection }: Props) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("reach");
  const [selectedRange, setSelectedRange] = useState(30);

  const reachDelta = deltaPercent(stats.avg_reach_7d, stats.avg_reach_prev_7d);
  const engagementDelta = deltaPercent(stats.avg_engagement_7d, stats.avg_engagement_prev_7d);

  // Filter by selected range
  const filteredMetrics = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - selectedRange);
    return dailyMetrics.filter((d) => {
      const date = typeof d.metric_date === "string" ? new Date(d.metric_date) : d.metric_date;
      return date >= cutoff;
    });
  }, [dailyMetrics, selectedRange]);

  // Chart data
  const chartData = filteredMetrics.map((d) => ({
    date: typeof d.metric_date === 'string' ? d.metric_date : new Date(d.metric_date).toISOString().split('T')[0],
    value: (d[selectedMetric] as number) || 0,
  }));

  const maxValue = Math.max(...chartData.map((d) => d.value), 1);

  // Auto-select best range based on available data
  const availableDays = dailyMetrics.length;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* Seguidores */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <div className="text-xs text-[var(--text-muted)] mb-1">Seguidores</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {formatNumber(stats.followers)}
          </div>
          <div className={`text-xs mt-1 ${stats.followers_delta >= 0 ? "text-green-400" : "text-red-400"}`}>
            {stats.followers_delta >= 0 ? "+" : ""}{stats.followers_delta} esta semana
          </div>
        </div>

        {/* Alcance promedio 7d */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <div className="text-xs text-[var(--text-muted)] mb-1">Alcance prom. 7d</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {formatNumber(stats.avg_reach_7d)}
          </div>
          <div className={`text-xs mt-1 ${reachDelta.positive ? "text-green-400" : "text-red-400"}`}>
            {reachDelta.label} vs semana anterior
          </div>
        </div>

        {/* Interacciones promedio 7d */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <div className="text-xs text-[var(--text-muted)] mb-1">Interacciones prom. 7d</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {formatNumber(stats.avg_engagement_7d)}
          </div>
          <div className={`text-xs mt-1 ${engagementDelta.positive ? "text-green-400" : "text-red-400"}`}>
            {engagementDelta.label} vs semana anterior
          </div>
        </div>

        {/* Total posts */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <div className="text-xs text-[var(--text-muted)] mb-1">Total publicaciones</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {stats.total_posts}
          </div>
          <div className="text-xs mt-1 text-[var(--text-muted)]">
            en tu cuenta
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Tendencia</h2>
            <div className="flex rounded border border-[var(--border)] overflow-hidden">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setSelectedRange(opt.days)}
                  className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    selectedRange === opt.days
                      ? "bg-indigo-600 text-white"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {availableDays < selectedRange && (
              <span className="text-[10px] text-[var(--text-muted)]">
                ({availableDays} {availableDays === 1 ? "dia" : "dias"} disponibles)
              </span>
            )}
          </div>
          <select
            value={selectedMetric}
            onChange={(e) => setSelectedMetric(e.target.value as MetricKey)}
            className="text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
          >
            {METRIC_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {chartData.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">
            No hay datos de tendencia disponibles. Los datos se acumulan con el sync diario.
          </div>
        ) : (
          <div className="relative h-64">
            {/* Y axis labels */}
            <div className="absolute left-0 top-0 bottom-6 w-12 flex flex-col justify-between text-right pr-2">
              <span className="text-[10px] text-[var(--text-muted)]">{formatNumber(maxValue)}</span>
              <span className="text-[10px] text-[var(--text-muted)]">{formatNumber(Math.round(maxValue / 2))}</span>
              <span className="text-[10px] text-[var(--text-muted)]">0</span>
            </div>

            {/* Bars */}
            <div className="ml-14 h-full flex items-end gap-[2px] pb-6">
              {chartData.map((d, i) => {
                const height = maxValue > 0 ? (d.value / maxValue) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center group relative" style={{ maxWidth: chartData.length < 10 ? "60px" : undefined }}>
                    <div
                      className="w-full bg-indigo-500/60 hover:bg-indigo-500 rounded-t transition-all cursor-pointer"
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                      <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-xs whitespace-nowrap">
                        <div className="text-[var(--text-primary)] font-medium">{formatNumber(d.value)}</div>
                        <div className="text-[var(--text-muted)]">{d.date}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* X axis labels */}
            <div className="ml-14 flex justify-between mt-1">
              {chartData.length > 0 && (
                <>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {chartData[0].date.slice(5)}
                  </span>
                  {chartData.length > 2 && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {chartData[Math.floor(chartData.length / 2)].date.slice(5)}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {chartData[chartData.length - 1].date.slice(5)}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Breakdowns (ultimo dia disponible) */}
      {dailyMetrics.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {/* Reach por surface */}
          <BreakdownCard
            title="Alcance por superficie"
            data={dailyMetrics[dailyMetrics.length - 1].breakdowns?.reach_by_surface || {}}
          />
          {/* Reach por follow type */}
          <BreakdownCard
            title="Alcance por tipo de seguidor"
            data={dailyMetrics[dailyMetrics.length - 1].breakdowns?.reach_by_follow_type || {}}
          />
        </div>
      )}
    </div>
  );
}

function BreakdownCard({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">{title}</h3>
        <div className="text-xs text-[var(--text-muted)]">Sin datos disponibles</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">{title}</h3>
      <div className="space-y-2">
        {entries.map(([label, value]) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          return (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--text-muted)]">{label}</span>
                <span className="text-[var(--text-primary)]">
                  {formatNumber(value)} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full h-1.5 bg-[var(--bg-primary)] rounded-full">
                <div
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
