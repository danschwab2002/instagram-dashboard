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

const BRIEFING_MARKER = "[BRIEFING_COMPLETE]";

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { session_id, message } = body as { session_id: number; message: string };

  if (!session_id || !message?.trim()) {
    return NextResponse.json({ error: "session_id y message son requeridos" }, { status: 400 });
  }

  // Load session with ownership check
  const sessionRes = await pool.query(
    `SELECT * FROM ai_sessions WHERE id = $1 AND user_id = $2`,
    [session_id, user.id]
  );
  if (sessionRes.rows.length === 0) {
    return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });
  }
  const session = sessionRes.rows[0];

  // Get user's AI provider and corresponding API key
  const profileRes = await pool.query(
    `SELECT ai_provider, openai_api_key, gemini_api_key, claude_api_key FROM user_profiles WHERE user_id = $1`,
    [user.id]
  );
  const profile = profileRes.rows[0];
  const provider = profile?.ai_provider || "openai";

  const keyMap: Record<string, string | null> = {
    openai: profile?.openai_api_key,
    gemini: profile?.gemini_api_key,
    claude: profile?.claude_api_key,
  };
  const apiKey = keyMap[provider];

  if (!apiKey) {
    return NextResponse.json({
      error: `Necesitás configurar tu API Key de ${provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : "Claude"} en Configuración.`,
    }, { status: 400 });
  }

  // Check webhook URL
  const webhookUrl = process.env.N8N_AI_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "Webhook de AI no configurado" }, { status: 500 });
  }

  // Save user message
  await pool.query(
    `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
    [session_id, message.trim()]
  );

  // Detect phase transition: if last assistant message had BRIEFING_COMPLETE marker
  let currentPhase = session.phase;
  if (currentPhase === "briefing") {
    const lastAssistantRes = await pool.query(
      `SELECT content FROM ai_messages WHERE session_id = $1 AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`,
      [session_id]
    );
    if (lastAssistantRes.rows[0]?.content?.includes(BRIEFING_MARKER)) {
      currentPhase = "analysis";
      await pool.query(
        `UPDATE ai_sessions SET phase = 'analysis', updated_at = NOW() WHERE id = $1`,
        [session_id]
      );
    }
  }

  // Call n8n webhook
  try {
    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id,
        session_key: `${session.agent_type}_${user.id}_${session_id}`,
        message: message.trim(),
        dataset_id: session.dataset_id,
        phase: currentPhase,
        agent_type: session.agent_type,
        api_key: apiKey,
        provider,
      }),
    });

    if (!n8nResponse.ok) {
      const errText = await n8nResponse.text();
      console.error("n8n webhook error:", errText);
      return NextResponse.json({ error: "Error del agente de IA. Intentá de nuevo." }, { status: 502 });
    }

    const n8nRaw = await n8nResponse.json();
    // n8n can return an object or an array of objects
    const n8nData = Array.isArray(n8nRaw) ? n8nRaw[0] : n8nRaw;
    const assistantMessage = n8nData?.output || n8nData?.response || n8nData?.text || (typeof n8nData === "string" ? n8nData : JSON.stringify(n8nData));

    // Strip briefing marker before saving
    const cleanMessage = assistantMessage.replace(BRIEFING_MARKER, "").trim();
    const briefingComplete = assistantMessage.includes(BRIEFING_MARKER);

    // Save assistant message
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
      [session_id, cleanMessage]
    );
    await pool.query(`UPDATE ai_sessions SET updated_at = NOW() WHERE id = $1`, [session_id]);

    return NextResponse.json({
      message: cleanMessage,
      briefing_complete: briefingComplete,
      phase: briefingComplete ? "analysis" : currentPhase,
    });
  } catch (error) {
    console.error("Error calling n8n webhook:", error);
    return NextResponse.json({ error: "Error de conexión con el agente de IA." }, { status: 502 });
  }
}
