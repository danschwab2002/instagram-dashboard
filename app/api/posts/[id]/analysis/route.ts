import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "../../../../lib/supabase/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// GET /api/posts/[id]/analysis
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  const result = await pool.query(
    `SELECT * FROM post_analyses WHERE post_id = $1 LIMIT 1`,
    [id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ analysis: null });
  }

  return NextResponse.json({ analysis: result.rows[0] });
}
