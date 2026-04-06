import { requireUser } from "../lib/auth";
import { getAiSessions, getDatasetsForUser } from "../lib/db";
import { Pool } from "pg";
import { AiAnalysisPage } from "./AiAnalysisPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Analysis — Antigravity",
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export default async function Page() {
  const user = await requireUser();

  const [sessions, datasets, profileRes] = await Promise.all([
    getAiSessions(user.id),
    getDatasetsForUser(user.id),
    pool.query(`SELECT gemini_api_key FROM user_profiles WHERE user_id = $1`, [user.id]),
  ]);

  const hasGeminiKey = !!profileRes.rows[0]?.gemini_api_key;

  return (
    <AiAnalysisPage
      initialSessions={sessions}
      datasets={datasets}
      hasGeminiKey={hasGeminiKey}
    />
  );
}
