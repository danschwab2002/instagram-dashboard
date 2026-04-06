import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "../../../lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAgent, formatDatasetMetadata, formatDatasetFullContent } from "../../../lib/agents";
import { getDatasetMetadataForAgent, getDatasetFullContent } from "../../../lib/db";

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

  // Check Gemini API key
  const profileRes = await pool.query(
    `SELECT gemini_api_key FROM user_profiles WHERE user_id = $1`,
    [user.id]
  );
  const geminiApiKey = profileRes.rows[0]?.gemini_api_key;
  if (!geminiApiKey) {
    return NextResponse.json({
      error: "Necesitás configurar tu API Key de Gemini en Configuración para usar AI Analysis.",
    }, { status: 400 });
  }

  // Save user message
  await pool.query(
    `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
    [session_id, message.trim()]
  );
  await pool.query(`UPDATE ai_sessions SET updated_at = NOW() WHERE id = $1`, [session_id]);

  // Load full message history
  const historyRes = await pool.query(
    `SELECT role, content FROM ai_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [session_id]
  );
  const allMessages = historyRes.rows;

  // ── Phase transition detection ──
  const agent = getAgent(session.agent_type);
  if (!agent) {
    return NextResponse.json({ error: "Agente no válido" }, { status: 400 });
  }

  let systemInstruction = "";
  const chatHistory: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  let phaseTransitioned = false;

  // Check if briefing just completed (last assistant message had the marker)
  if (session.phase === "briefing") {
    const lastAssistant = [...allMessages].reverse().find(m => m.role === "assistant");
    if (lastAssistant && lastAssistant.content.includes(BRIEFING_MARKER)) {
      // Transition to analysis phase
      phaseTransitioned = true;
      await pool.query(
        `UPDATE ai_sessions SET phase = 'analysis', updated_at = NOW() WHERE id = $1`,
        [session_id]
      );

      // Load full dataset content
      const fullContent = await getDatasetFullContent(session.dataset_id);
      const metadata = await getDatasetMetadataForAgent(session.dataset_id);
      const dataContext = formatDatasetFullContent(fullContent);
      const metadataContext = formatDatasetMetadata(metadata);

      // Save data injection as system message
      await pool.query(
        `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'system', $2)`,
        [session_id, `[Datos del dataset cargados: ${fullContent.length} posts]`]
      );

      // Build system instruction with analysis prompt + full data
      systemInstruction = `${agent.analysisPrompt}\n\n${metadataContext}\n\n${dataContext}`;
    }
  }

  // Build system instruction if not already set by phase transition
  if (!systemInstruction) {
    // Use the first system message as the system instruction
    const systemMessages = allMessages.filter(m => m.role === "system");
    if (systemMessages.length > 0) {
      systemInstruction = systemMessages[0].content;
    }

    // If in analysis phase (previously transitioned), rebuild with full data
    if (session.phase === "analysis" && !phaseTransitioned) {
      const fullContent = await getDatasetFullContent(session.dataset_id);
      const metadata = await getDatasetMetadataForAgent(session.dataset_id);
      systemInstruction = `${agent.analysisPrompt}\n\n${formatDatasetMetadata(metadata)}\n\n${formatDatasetFullContent(fullContent)}`;
    }
  }

  // Build chat history (exclude system messages)
  const nonSystemMessages = allMessages.filter(m => m.role !== "system");
  for (const msg of nonSystemMessages) {
    const role = msg.role === "assistant" ? "model" : "user";
    // Clean briefing marker from history
    const content = msg.content.replace(BRIEFING_MARKER, "").trim();
    if (!content) continue;

    // Merge consecutive same-role messages
    const last = chatHistory[chatHistory.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += "\n\n" + content;
    } else {
      chatHistory.push({ role, parts: [{ text: content }] });
    }
  }

  // ── Gemini streaming call ──
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";

      try {
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          systemInstruction: systemInstruction || undefined,
        });

        const chat = model.startChat({
          history: chatHistory.slice(0, -1), // all except last user message
        });

        // Last user message is the one we just saved
        const lastUserMsg = chatHistory[chatHistory.length - 1];
        const userText = lastUserMsg?.parts[0]?.text || message.trim();

        const result = await chat.sendMessageStream(userText);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            fullResponse += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }

        // Strip briefing marker before saving
        let cleanResponse = fullResponse;
        if (fullResponse.includes(BRIEFING_MARKER)) {
          cleanResponse = fullResponse.replace(BRIEFING_MARKER, "").trim();
        }

        // Save assistant message
        await pool.query(
          `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [session_id, cleanResponse]
        );
        await pool.query(`UPDATE ai_sessions SET updated_at = NOW() WHERE id = $1`, [session_id]);

        // If this response contained the briefing marker, notify client
        const briefingComplete = fullResponse.includes(BRIEFING_MARKER);

        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ done: true, briefing_complete: briefingComplete })}\n\n`
        ));
        controller.close();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Error desconocido";
        let userFriendly = "Error generando respuesta. Intentá de nuevo.";

        if (errMsg.includes("API_KEY_INVALID") || errMsg.includes("401")) {
          userFriendly = "Tu API key de Gemini es inválida. Revisala en Configuración.";
        } else if (errMsg.includes("429") || errMsg.includes("RATE_LIMIT")) {
          userFriendly = "Demasiadas solicitudes. Esperá un momento y volvé a intentar.";
        }

        console.error("Gemini streaming error:", errMsg);

        // Save partial response if any
        if (fullResponse) {
          await pool.query(
            `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
            [session_id, fullResponse + "\n\n[Error: respuesta incompleta]"]
          );
        }

        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ error: userFriendly })}\n\n`
        ));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
