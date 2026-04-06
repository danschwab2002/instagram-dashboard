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
