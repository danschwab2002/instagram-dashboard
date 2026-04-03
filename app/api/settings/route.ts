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

// GET /api/settings — obtener perfil del usuario
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await pool.query(
    `SELECT apify_api_key, gemini_api_key FROM user_profiles WHERE user_id = $1`,
    [user.id]
  );

  return NextResponse.json({
    apify_api_key: result.rows[0]?.apify_api_key || null,
    gemini_api_key: result.rows[0]?.gemini_api_key || null,
  });
}

// PUT /api/settings — actualizar perfil del usuario
export async function PUT(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { apify_api_key, gemini_api_key } = body as { apify_api_key: string | null; gemini_api_key: string | null };

  await pool.query(
    `INSERT INTO user_profiles (user_id, apify_api_key, gemini_api_key, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       apify_api_key = $2,
       gemini_api_key = $3,
       updated_at = NOW()`,
    [user.id, apify_api_key || null, gemini_api_key || null]
  );

  return NextResponse.json({ saved: true });
}
