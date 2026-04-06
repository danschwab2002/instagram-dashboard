import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
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

// GET /api/ai/sessions/[id] — session detail with messages
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  const sessionRes = await pool.query(
    `SELECT s.*, d.name as dataset_name
     FROM ai_sessions s
     JOIN datasets d ON d.id = s.dataset_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, user.id]
  );
  if (sessionRes.rows.length === 0) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  const messagesRes = await pool.query(
    `SELECT * FROM ai_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  return NextResponse.json({
    session: sessionRes.rows[0],
    messages: messagesRes.rows,
  });
}

// PUT /api/ai/sessions/[id] — update name, tags, status
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { name, tags, status } = body as {
    name?: string;
    tags?: string[];
    status?: string;
  };

  const sets: string[] = [];
  const values: (string | string[] | null)[] = [];
  let idx = 1;

  if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name.trim()); }
  if (tags !== undefined) { sets.push(`tags = $${idx++}`); values.push(tags); }
  if (status !== undefined) { sets.push(`status = $${idx++}`); values.push(status); }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  sets.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE ai_sessions SET ${sets.join(", ")} WHERE id = $${idx++} AND user_id = $${idx++} RETURNING id`,
    [...values, id, user.id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  return NextResponse.json({ updated: true });
}

// DELETE /api/ai/sessions/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  const result = await pool.query(
    `DELETE FROM ai_sessions WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, user.id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
