import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "../../../lib/supabase/server";
import { getAgent, formatDatasetMetadata } from "../../../lib/agents";
import { getDatasetMetadataForAgent } from "../../../lib/db";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET /api/ai/sessions — list sessions for user
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await pool.query(`
    SELECT
      s.*,
      d.name as dataset_name,
      (SELECT COUNT(*)::int FROM ai_messages m WHERE m.session_id = s.id AND m.role != 'system') as message_count
    FROM ai_sessions s
    JOIN datasets d ON d.id = s.dataset_id
    WHERE s.user_id = $1
    ORDER BY s.updated_at DESC
  `, [user.id]);

  return NextResponse.json(result.rows);
}

// POST /api/ai/sessions — create a new session
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { name, agent_type, dataset_id } = body as {
    name?: string;
    agent_type: string;
    dataset_id: number;
  };

  if (!agent_type || !dataset_id) {
    return NextResponse.json({ error: "agent_type y dataset_id son requeridos" }, { status: 400 });
  }

  const agent = getAgent(agent_type);
  if (!agent) {
    return NextResponse.json({ error: "Agente no válido" }, { status: 400 });
  }

  // Verify dataset belongs to user
  const dsCheck = await pool.query(
    `SELECT id, name FROM datasets WHERE id = $1 AND user_id = $2`,
    [dataset_id, user.id]
  );
  if (dsCheck.rows.length === 0) {
    return NextResponse.json({ error: "Dataset no encontrado" }, { status: 404 });
  }

  const datasetName = dsCheck.rows[0].name;
  const sessionName = name?.trim() || `${agent.name} — ${datasetName}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create session
    const sessionRes = await client.query(
      `INSERT INTO ai_sessions (user_id, name, agent_type, dataset_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [user.id, sessionName, agent_type, dataset_id]
    );
    const session = sessionRes.rows[0];

    // Build initial system message with dataset metadata
    const metadata = await getDatasetMetadataForAgent(dataset_id);
    const systemContent = `${agent.briefingPrompt}\n\n${formatDatasetMetadata(metadata)}`;

    await client.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'system', $2)`,
      [session.id, systemContent]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ...session,
      dataset_name: datasetName,
      message_count: 0,
    }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating AI session:", error);
    return NextResponse.json({ error: "Error creando sesión" }, { status: 500 });
  } finally {
    client.release();
  }
}
