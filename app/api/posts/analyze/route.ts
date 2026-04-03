import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "../../../lib/supabase/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// POST /api/posts/analyze
// Recibe { postIds: string[] } y dispara el workflow de deep analysis en n8n
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { postIds } = await request.json();

  if (!Array.isArray(postIds) || postIds.length === 0) {
    return NextResponse.json({ error: "postIds requerido" }, { status: 400 });
  }

  // Obtener Gemini API key del usuario
  const profileResult = await pool.query(
    `SELECT gemini_api_key FROM user_profiles WHERE user_id = $1`,
    [user.id]
  );
  const geminiApiKey = profileResult.rows[0]?.gemini_api_key || null;

  // Marcar posts como "analyzing"
  const placeholders = postIds.map((_, i) => `$${i + 1}`).join(",");
  await pool.query(
    `UPDATE posts SET analysis_status = 'analyzing' WHERE id IN (${placeholders})`,
    postIds
  );

  // Disparar webhook de n8n
  const webhookUrl = process.env.N8N_ANALYSIS_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "Webhook de análisis no configurado" }, { status: 500 });
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_ids: postIds, gemini_api_key: geminiApiKey }),
    });
  } catch {
    // Revertir status si el webhook falla
    await pool.query(
      `UPDATE posts SET analysis_status = 'pending' WHERE id IN (${placeholders})`,
      postIds
    );
    return NextResponse.json({ error: "Error al contactar n8n" }, { status: 502 });
  }

  return NextResponse.json({
    message: `Análisis iniciado para ${postIds.length} posts`,
    count: postIds.length,
  });
}
