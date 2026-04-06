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
    `SELECT apify_api_key, gemini_api_key, openai_api_key, claude_api_key, ai_provider FROM user_profiles WHERE user_id = $1`,
    [user.id]
  );

  const row = result.rows[0];
  return NextResponse.json({
    apify_api_key: row?.apify_api_key || null,
    gemini_api_key: row?.gemini_api_key || null,
    openai_api_key: row?.openai_api_key || null,
    claude_api_key: row?.claude_api_key || null,
    ai_provider: row?.ai_provider || "openai",
  });
}

// PUT /api/settings — actualizar perfil del usuario
export async function PUT(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { apify_api_key, gemini_api_key, openai_api_key, claude_api_key, ai_provider } = body as {
    apify_api_key: string | null;
    gemini_api_key: string | null;
    openai_api_key: string | null;
    claude_api_key: string | null;
    ai_provider: string;
  };

  await pool.query(
    `INSERT INTO user_profiles (user_id, apify_api_key, gemini_api_key, openai_api_key, claude_api_key, ai_provider, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       apify_api_key = $2,
       gemini_api_key = $3,
       openai_api_key = $4,
       claude_api_key = $5,
       ai_provider = $6,
       updated_at = NOW()`,
    [user.id, apify_api_key || null, gemini_api_key || null, openai_api_key || null, claude_api_key || null, ai_provider || "openai"]
  );

  return NextResponse.json({ saved: true });
}
