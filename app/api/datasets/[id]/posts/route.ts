import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { createClient } from "../../../../lib/supabase/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function verifyOwnership(datasetId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM datasets WHERE id = $1 AND user_id = $2`,
    [datasetId, userId]
  );
  return result.rows.length > 0;
}

async function recalcMetrics(client: PoolClient, datasetId: string) {
  await client.query(`
    UPDATE datasets SET
      total_posts = COALESCE(s.total_posts, 0),
      total_creators = COALESCE(s.total_creators, 0),
      median_views = s.median_views,
      min_views = s.min_views,
      max_views = s.max_views,
      median_likes = s.median_likes,
      min_likes = s.min_likes,
      max_likes = s.max_likes,
      median_comments = s.median_comments,
      min_comments = s.min_comments,
      max_comments = s.max_comments,
      median_engagement = s.median_engagement,
      min_engagement = s.min_engagement,
      max_engagement = s.max_engagement,
      median_duration = s.median_duration,
      min_duration = s.min_duration,
      max_duration = s.max_duration,
      updated_at = NOW()
    FROM (
      SELECT
        COUNT(DISTINCT p.id)::int as total_posts,
        COUNT(DISTINCT p.account_id)::int as total_creators,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.video_view_count)::int as median_views,
        MIN(p.video_view_count) as min_views,
        MAX(p.video_view_count) as max_views,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.likes_count)::int as median_likes,
        MIN(p.likes_count) as min_likes,
        MAX(p.likes_count) as max_likes,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.comments_count)::int as median_comments,
        MIN(p.comments_count) as min_comments,
        MAX(p.comments_count) as max_comments,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.engagement_rate)::real as median_engagement,
        MIN(p.engagement_rate) as min_engagement,
        MAX(p.engagement_rate) as max_engagement,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.video_duration)::real as median_duration,
        MIN(p.video_duration) as min_duration,
        MAX(p.video_duration) as max_duration
      FROM dataset_posts dp
      JOIN posts p ON p.id = dp.post_id
      WHERE dp.dataset_id = $1
    ) s
    WHERE datasets.id = $1
  `, [datasetId]);
}

// POST /api/datasets/[id]/posts — agregar posts al dataset
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  if (!(await verifyOwnership(id, user.id))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const body = await request.json();
  const { post_ids, note } = body as { post_ids: number[]; note?: string };

  if (!post_ids?.length) {
    return NextResponse.json({ error: "post_ids es requerido" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const postId of post_ids) {
      await client.query(
        `INSERT INTO dataset_posts (dataset_id, post_id, note)
         VALUES ($1, $2, $3)
         ON CONFLICT (dataset_id, post_id) DO NOTHING`,
        [id, postId, note || null]
      );
    }

    // Update status to active if it was draft and now has posts
    await client.query(
      `UPDATE datasets SET status = 'active'
       WHERE id = $1 AND status = 'draft'
       AND EXISTS (SELECT 1 FROM dataset_posts WHERE dataset_id = $1)`,
      [id]
    );

    // Recalculate metrics
    await recalcMetrics(client, id);

    await client.query("COMMIT");

    return NextResponse.json({ added: post_ids.length });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding posts to dataset:", error);
    return NextResponse.json({ error: "Error agregando posts" }, { status: 500 });
  } finally {
    client.release();
  }
}

// DELETE /api/datasets/[id]/posts — quitar posts del dataset
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  if (!(await verifyOwnership(id, user.id))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const body = await request.json();
  const { post_ids } = body as { post_ids: number[] };

  if (!post_ids?.length) {
    return NextResponse.json({ error: "post_ids es requerido" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const placeholders = post_ids.map((_, i) => `$${i + 2}`).join(",");
    await client.query(
      `DELETE FROM dataset_posts WHERE dataset_id = $1 AND post_id IN (${placeholders})`,
      [id, ...post_ids]
    );

    // If no posts remain, revert to draft
    await client.query(
      `UPDATE datasets SET status = 'draft'
       WHERE id = $1 AND status = 'active'
       AND NOT EXISTS (SELECT 1 FROM dataset_posts WHERE dataset_id = $1)`,
      [id]
    );

    // Recalculate metrics
    await recalcMetrics(client, id);

    await client.query("COMMIT");

    return NextResponse.json({ removed: post_ids.length });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error removing posts from dataset:", error);
    return NextResponse.json({ error: "Error quitando posts" }, { status: 500 });
  } finally {
    client.release();
  }
}
