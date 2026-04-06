import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "../../../lib/supabase/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET /api/datasets/[id] — export completo del dataset como JSON
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  // Dataset metadata
  const datasetRes = await pool.query(
    `SELECT * FROM datasets WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );
  if (datasetRes.rows.length === 0) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const ds = datasetRes.rows[0];

  // All posts with full detail
  const postsRes = await pool.query(`
    SELECT
      p.id, p.short_code, p.url, p.type, p.caption,
      p.likes_count, p.comments_count, p.shares_count,
      p.video_view_count, p.video_play_count, p.video_duration,
      p.engagement_rate, p.performance_score,
      p.posted_at, p.scraped_at, p.stored_url, p.product_type,
      p.analysis_status,
      COALESCE(a.username, 'desconocido') as username,
      a.full_name as creator_full_name,
      COALESCE(a.followers_count, 0) as creator_followers,
      COALESCE(
        (SELECT array_agg(h.tag) FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = p.id),
        ARRAY[]::TEXT[]
      ) as hashtags,
      dp.note as dataset_note,
      dp.added_at
    FROM dataset_posts dp
    JOIN posts p ON p.id = dp.post_id
    LEFT JOIN accounts a ON a.id = p.account_id
    WHERE dp.dataset_id = $1
    ORDER BY p.performance_score DESC NULLS LAST
  `, [id]);

  // AI analyses for posts that have them
  const postIds = postsRes.rows.map((p: { id: number }) => p.id);
  let analyses: Record<number, unknown> = {};
  if (postIds.length > 0) {
    const placeholders = postIds.map((_: number, i: number) => `$${i + 1}`).join(",");
    const analysesRes = await pool.query(
      `SELECT post_id, description as analysis
       FROM post_descriptions
       WHERE post_id IN (${placeholders})`,
      postIds
    );
    for (const row of analysesRes.rows) {
      try {
        analyses[row.post_id] = typeof row.analysis === "string" ? JSON.parse(row.analysis) : row.analysis;
      } catch {
        analyses[row.post_id] = row.analysis;
      }
    }
  }

  // Build export object
  const exportData = {
    dataset: {
      id: ds.id,
      name: ds.name,
      description: ds.description,
      context: ds.context,
      niche: ds.niche,
      objective: ds.objective,
      tags: ds.tags || [],
      keywords: ds.keywords || [],
      additional_notes: ds.additional_notes,
      status: ds.status,
      created_at: ds.created_at,
      updated_at: ds.updated_at,
    },
    metrics: {
      total_posts: ds.total_posts,
      total_creators: ds.total_creators,
      views: { median: ds.median_views, min: ds.min_views, max: ds.max_views },
      likes: { median: ds.median_likes, min: ds.min_likes, max: ds.max_likes },
      comments: { median: ds.median_comments, min: ds.min_comments, max: ds.max_comments },
      engagement: { median: ds.median_engagement, min: ds.min_engagement, max: ds.max_engagement },
      duration: { median: ds.median_duration, min: ds.min_duration, max: ds.max_duration },
    },
    posts: postsRes.rows.map((p: Record<string, unknown>) => ({
      ...p,
      ai_analysis: analyses[(p.id as number)] || null,
    })),
    exported_at: new Date().toISOString(),
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="dataset-${ds.id}-${ds.name.replace(/[^a-zA-Z0-9]/g, "_")}.json"`,
    },
  });
}

// PUT /api/datasets/[id] — actualizar metadata del dataset
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { name, description, context, niche, objective, tags, keywords, additional_notes, status } = body as {
    name?: string;
    description?: string;
    context?: string;
    niche?: string;
    objective?: string;
    tags?: string[];
    keywords?: string[];
    additional_notes?: string;
    status?: string;
  };

  // Build dynamic SET clause
  const sets: string[] = [];
  const values: (string | string[] | null)[] = [];
  let idx = 1;

  if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name.trim()); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description || null); }
  if (context !== undefined) { sets.push(`context = $${idx++}`); values.push(context || null); }
  if (niche !== undefined) { sets.push(`niche = $${idx++}`); values.push(niche || null); }
  if (objective !== undefined) { sets.push(`objective = $${idx++}`); values.push(objective || null); }
  if (tags !== undefined) { sets.push(`tags = $${idx++}`); values.push(tags); }
  if (keywords !== undefined) { sets.push(`keywords = $${idx++}`); values.push(keywords); }
  if (additional_notes !== undefined) { sets.push(`additional_notes = $${idx++}`); values.push(additional_notes || null); }
  if (status !== undefined) { sets.push(`status = $${idx++}`); values.push(status); }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  sets.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE datasets SET ${sets.join(", ")} WHERE id = $${idx++} AND user_id = $${idx++} RETURNING id`,
    [...values, id, user.id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  return NextResponse.json({ updated: true });
}

// DELETE /api/datasets/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  const result = await pool.query(
    `DELETE FROM datasets WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, user.id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
