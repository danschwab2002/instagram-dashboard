"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/browser";
import { PulseView } from "./PulseView";
import { ContentView } from "./ContentView";
import { StoriesView } from "./StoriesView";
import type { IgConnection, IgPulseStats, IgDailyMetrics, IgMedia } from "../../lib/db";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/researches", label: "Investigaciones" },
  { href: "/datasets", label: "Datasets" },
  { href: "/ai", label: "AI Analysis" },
  { href: "/instagram", label: "Mi Instagram" },
  { href: "/settings", label: "Configuracion" },
];

const TABS = [
  { key: "pulse", label: "Pulso" },
  { key: "content", label: "Contenido" },
  { key: "stories", label: "Historias" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface Props {
  connection: IgConnection;
  pulseStats: IgPulseStats;
  dailyMetrics: IgDailyMetrics[];
  media: IgMedia[];
  totalMedia: number;
  activeStories: IgMedia[];
  historicalStories: IgMedia[];
  userEmail: string;
}

export function InstagramDashboard({
  connection,
  pulseStats,
  dailyMetrics,
  media,
  totalMedia,
  activeStories,
  historicalStories,
  userEmail,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("pulse");
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="px-4 py-5">
          <div className="text-sm font-bold tracking-widest text-[var(--text-primary)]">
            ANTIGRAVITY
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
            Content Dashboard
          </div>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV_LINKS.map((link) => {
            const isActive = link.href === "/instagram";
            return (
              <a
                key={link.href}
                href={link.href}
                className={`block px-3 py-2 rounded text-sm transition ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-400"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5"
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-[var(--border)]">
          <div className="text-xs text-[var(--text-muted)] truncate">
            {userEmail}
          </div>
          <button
            onClick={handleSignOut}
            className="text-xs text-red-400 hover:text-red-300 mt-1"
          >
            Cerrar sesion
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="shrink-0 px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {connection.ig_profile_picture_url && (
                <img
                  src={connection.ig_profile_picture_url}
                  alt={connection.ig_username}
                  className="w-10 h-10 rounded-full"
                />
              )}
              <div>
                <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                  @{connection.ig_username}
                </h1>
                <span className="text-xs text-[var(--text-muted)]">
                  {connection.ig_name}
                  {connection.last_synced_at && (
                    <> · Ultima sync: {new Date(connection.last_synced_at).toLocaleDateString("es-AR")}</>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-1.5 text-sm rounded transition ${
                  activeTab === tab.key
                    ? "bg-indigo-500/15 text-indigo-400"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "pulse" && (
            <PulseView
              stats={pulseStats}
              dailyMetrics={dailyMetrics}
              connection={connection}
            />
          )}
          {activeTab === "content" && (
            <ContentView
              media={media}
              total={totalMedia}
              connectionId={connection.id}
            />
          )}
          {activeTab === "stories" && (
            <StoriesView
              activeStories={activeStories}
              historicalStories={historicalStories}
            />
          )}
        </div>
      </main>
    </div>
  );
}
