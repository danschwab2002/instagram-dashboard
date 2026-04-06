import { Pool } from "pg";
import { requireUser } from "../lib/auth";
import { SettingsPage } from "./SettingsPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Configuración — Antigravity",
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export default async function Page() {
  const user = await requireUser();

  const result = await pool.query(
    `SELECT apify_api_key, gemini_api_key, openai_api_key, claude_api_key, ai_provider FROM user_profiles WHERE user_id = $1`,
    [user.id]
  );

  return (
    <SettingsPage
      userEmail={user.email || ""}
      apifyApiKey={result.rows[0]?.apify_api_key || ""}
      geminiApiKey={result.rows[0]?.gemini_api_key || ""}
      openaiApiKey={result.rows[0]?.openai_api_key || ""}
      claudeApiKey={result.rows[0]?.claude_api_key || ""}
      aiProvider={result.rows[0]?.ai_provider || "openai"}
    />
  );
}
