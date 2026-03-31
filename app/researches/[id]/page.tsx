import { Pool } from "pg";
import { notFound } from "next/navigation";
import { ResearchDetail } from "./ResearchDetail";

export const dynamic = "force-dynamic";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await pool.query(`SELECT name FROM researches WHERE id = $1`, [id]);
  if (result.rows.length === 0) return { title: "No encontrada" };
  return { title: `${result.rows[0].name} — Antigravity` };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const researchId = parseInt(id);

  // Research info
  const researchResult = await pool.query(
    `SELECT id, name, description, status, created_at FROM researches WHERE id = $1`,
    [researchId]
  );
  if (researchResult.rows.length === 0) notFound();
  const research = researchResult.rows[0];

  // Accounts linked to this research
  const accountsResult = await pool.query(
    `SELECT
      a.id, a.username, a.full_name, a.followers_count, a.profile_pic_url,
      a.scraped, a.posts_scraped,
      COUNT(p.id)::int as posts_count,
      ROUND(AVG(p.engagement_rate)::numeric, 4) as avg_engagement
    FROM accounts a
    JOIN research_accounts ra ON ra.account_id = a.id
    LEFT JOIN posts p ON p.account_id = a.id
    WHERE ra.research_id = $1
    GROUP BY a.id
    ORDER BY a.followers_count DESC`,
    [researchId]
  );

  // Stats
  const statsResult = await pool.query(
    `SELECT
      COUNT(DISTINCT ra.account_id)::int as total_accounts,
      COUNT(p.id)::int as total_posts,
      COUNT(p.id) FILTER (WHERE p.type = 'Video')::int as total_videos,
      ROUND(AVG(p.engagement_rate)::numeric, 4) as avg_engagement,
      ROUND(AVG(p.video_view_count) FILTER (WHERE p.video_view_count IS NOT NULL))::int as avg_views
    FROM research_accounts ra
    LEFT JOIN posts p ON p.account_id = ra.account_id
    WHERE ra.research_id = $1`,
    [researchId]
  );

  return (
    <ResearchDetail
      research={research}
      accounts={accountsResult.rows}
      stats={statsResult.rows[0]}
    />
  );
}
