import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "../../lib/supabase/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET /api/datasets — lista datasets del usuario
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await pool.query(`
    SELECT
      d.id, d.name, d.description, d.niche, d.status, d.created_at, d.updated_at,
      COUNT(DISTINCT dp.post_id)::int as posts_count,
      COUNT(DISTINCT p.account_id)::int as creators_count
    FROM datasets d
    LEFT JOIN dataset_posts dp ON dp.dataset_id = d.id
    LEFT JOIN posts p ON p.id = dp.post_id
    WHERE d.user_id = $1
    GROUP BY d.id
    ORDER BY d.updated_at DESC
  `, [user.id]);

  return NextResponse.json(result.rows);
}

// POST /api/datasets — crea un dataset
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { name, description, context, niche, objective, tags, keywords, additional_notes } = body as {
    name: string;
    description?: string;
    context?: string;
    niche?: string;
    objective?: string;
    tags?: string[];
    keywords?: string[];
    additional_notes?: string;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
  }

  const result = await pool.query(
    `INSERT INTO datasets (user_id, name, description, context, niche, objective, tags, keywords, additional_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, status, created_at`,
    [
      user.id,
      name.trim(),
      description || null,
      context || null,
      niche || null,
      objective || null,
      tags || [],
      keywords || [],
      additional_notes || null,
    ]
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}
