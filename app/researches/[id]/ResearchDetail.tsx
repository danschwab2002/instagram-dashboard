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
}

interface Account {
  id: number;
  username: string;
  full_name: string | null;
  followers_count: number;
  profile_pic_url: string | null;
  scraped: boolean;
  posts_scraped: boolean;
  posts_count: number;
  avg_engagement: number | null;
}

interface Stats {
  total_accounts: number;
  total_posts: number;
  total_videos: number;
  avg_engagement: number | null;
  avg_views: number | null;
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

function accountStatus(scraped: boolean, postScraped: boolean) {
  if (postScraped) return { text: "Completo", color: "text-green-400" };
  if (scraped) return { text: "Perfil OK, posts pendientes", color: "text-yellow-400" };
  return { text: "Pendiente", color: "text-zinc-400" };
}

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

export function ResearchDetail({
  research,
  accounts,
  stats,
}: {
  research: Research;
  accounts: Account[];
  stats: Stats;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const badge = statusBadge(research.status);
  const createdDate = new Date(research.created_at);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/researches/${research.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/researches");
      }
    } finally {
      setDeleting(false);
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

        <nav className="p-3 border-b border-[var(--border)] flex flex-col gap-1">
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
            href="/ai"
            className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            AI Analysis
          </Link>
          <Link
            href="/settings"
            className="px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Configuración
          </Link>
        </nav>

        {/* Accounts in this research */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-semibold">
            Cuentas ({accounts.length})
          </p>
          {accounts.map((a) => {
            const status = accountStatus(a.scraped, a.posts_scraped);
            return (
              <div
                key={a.id}
                className="px-2 py-1.5 text-sm text-[var(--text-secondary)] truncate"
                title={`@${a.username} — ${formatNumber(a.followers_count)} followers — ${status.text}`}
              >
                <span>@{a.username}</span>
                <span className={`ml-1 text-[10px] ${status.color}`}>
                  {a.scraped ? (a.posts_scraped ? "✓" : "◑") : "○"}
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/researches"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              ← Investigaciones
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{research.name}</h2>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${badge.color}`}>
              {badge.text}
            </span>
          </div>
          {research.description && (
            <p className="text-sm text-[var(--text-muted)] mt-1">{research.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <p className="text-xs text-[var(--text-muted)]">
              Creada el {createdDate.toLocaleDateString("es-AR")} a las{" "}
              {createdDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </p>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
              >
                Eliminar
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-xs text-red-400">Confirmar?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {deleting ? "Eliminando..." : "Sí, eliminar"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  Cancelar
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
          <StatCard label="Cuentas" value={String(stats.total_accounts)} />
          <StatCard label="Posts" value={formatNumber(stats.total_posts)} />
          <StatCard label="Reels" value={formatNumber(stats.total_videos)} />
          <StatCard label="Eng. promedio" value={formatPercent(stats.avg_engagement)} />
          <StatCard label="Views promedio" value={formatNumber(stats.avg_views)} />
          <div className="ml-auto">
            <Link
              href={`/?research=${research.id}`}
              className="px-3 py-1.5 text-xs rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
            >
              Ver en Dashboard →
            </Link>
          </div>
        </div>

        {/* Accounts table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Cuenta</th>
                <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Seguidores</th>
                <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Posts scrapeados</th>
                <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Eng. promedio</th>
                <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Estado perfil</th>
                <th className="text-left px-4 py-2 text-[var(--text-muted)] font-medium">Estado posts</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const profStatus = a.scraped
                  ? { text: "Scrapeado", color: "text-green-400" }
                  : { text: "Pendiente", color: "text-zinc-400" };
                const postStatus = a.posts_scraped
                  ? { text: "Scrapeados", color: "text-green-400" }
                  : a.scraped
                  ? { text: "Pendiente", color: "text-yellow-400" }
                  : { text: "Esperando perfil", color: "text-zinc-500" };

                return (
                  <tr
                    key={a.id}
                    className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <span className="text-[var(--text-primary)]">@{a.username}</span>
                        {a.full_name && (
                          <span className="text-xs text-[var(--text-muted)] ml-2">
                            {a.full_name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-primary)] tabular-nums">
                      {formatNumber(a.followers_count)}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-primary)] tabular-nums">
                      {a.posts_count}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatPercent(a.avg_engagement)}
                    </td>
                    <td className={`px-4 py-3 text-xs ${profStatus.color}`}>
                      {profStatus.text}
                    </td>
                    <td className={`px-4 py-3 text-xs ${postStatus.color}`}>
                      {postStatus.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
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
