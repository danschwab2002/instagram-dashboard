import { Pool } from "pg";
import { requireUser } from "../lib/auth";
import { ResearchesPage } from "./ResearchesPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Investigaciones — Antigravity",
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export default async function Page() {
  const user = await requireUser();

  const result = await pool.query(`
    SELECT
      r.id, r.name, r.description, r.status, r.created_at,
      COUNT(ra.account_id)::int as accounts_count,
      COALESCE(
        (SELECT COUNT(*) FROM posts p
         JOIN research_accounts ra2 ON ra2.account_id = p.account_id
         WHERE ra2.research_id = r.id)::int,
        0
      ) as posts_count
    FROM researches r
    LEFT JOIN research_accounts ra ON ra.research_id = r.id
    WHERE r.user_id = $1
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `, [user.id]);

  return <ResearchesPage researches={result.rows} />;
}
