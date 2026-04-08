import { requireUser } from "../lib/auth";
import { getIgConnection, getIgDailyMetrics, getIgPulseStats, getIgMedia } from "../lib/db";
import { InstagramDashboard } from "./components/InstagramDashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const connection = await getIgConnection(user.id);

  if (!connection) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-4">
            No hay cuenta conectada
          </h1>
          <p className="text-[var(--text-muted)] mb-6">
            Conecta tu cuenta de Instagram desde Configuracion para ver tu dashboard.
          </p>
          <a
            href="/settings"
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
          >
            Ir a Configuracion
          </a>
        </div>
      </div>
    );
  }

  const [pulseStats, dailyMetrics, mediaResult] = await Promise.all([
    getIgPulseStats(connection.id),
    getIgDailyMetrics(connection.id, 30),
    getIgMedia(connection.id, "published_at", "DESC", 100, 0),
  ]);

  return (
    <InstagramDashboard
      connection={connection}
      pulseStats={pulseStats}
      dailyMetrics={dailyMetrics}
      media={mediaResult.media}
      totalMedia={mediaResult.total}
      userEmail={user.email || ""}
    />
  );
}
