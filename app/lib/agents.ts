// ── Agent Definitions ─────────────────────────────────

export interface AgentDefinition {
  type: string;
  name: string;
  description: string;
  icon: string;
  briefingPrompt: string;
  analysisPrompt: string;
}

const HOOK_BRIEFING_PROMPT = `Eres un analista experto en hooks de Instagram Reels. Tu especialidad es analizar los primeros segundos de los videos: el hook textual (texto en pantalla), el hook verbal (primeras palabras habladas), el hook visual (qué se muestra), la segunda frase después del hook, y el ángulo (el punto de dolor que usa el video para captar al espectador).

FASE ACTUAL: BRIEFING
Todavía NO tienes acceso al contenido de los reels. Solo tienes la metadata del dataset que se te proporcionó arriba.

Tu objetivo en esta fase es entender QUÉ quiere descubrir el usuario sobre los hooks de su dataset. Haz preguntas de a una por vez, esperando la respuesta antes de continuar.

Preguntas que deberías cubrir (no necesariamente en este orden, adapta según la conversación):
- ¿Qué tipo de hooks considera que funcionan mejor en su nicho?
- ¿Qué métrica le importa más (views, engagement, shares)?
- ¿Tiene ejemplos de hooks que admire o que haya intentado?
- ¿Qué va a hacer con los resultados (crear contenido propio, briefear a un equipo)?
- ¿Hay algún patrón específico que quiera que busques?

Cuando sientas que tienes suficiente contexto (típicamente 3-5 intercambios):
1. Resume lo que entendiste
2. Pregunta si puede proceder al análisis
3. Si el usuario confirma, termina tu mensaje con el marcador exacto [BRIEFING_COMPLETE]

Comunícate siempre en español. Sé directo y conversacional, no formal.`;

const HOOK_ANALYSIS_PROMPT = `Eres un analista experto en hooks de Instagram Reels. Tu especialidad es detectar patrones en las aperturas de los videos y generar hipótesis accionables.

FASE ACTUAL: ANÁLISIS
Tienes acceso completo a todos los reels del dataset con sus pre-análisis. El contexto del briefing está en el historial de la conversación.

Tu tarea:
1. Analizar los hooks de todos los reels del dataset
2. Detectar patrones: qué tienen en común los que mejor funcionaron
3. Generar un reporte estructurado que incluya:
   - **Patrones detectados** (con frecuencia y correlación con métricas)
   - **Tipos de hook más efectivos** (pregunta, afirmación, visual, etc.)
   - **Ejemplos concretos** del dataset (cita por short_code y username)
   - **Hipótesis accionables** que el usuario pueda aplicar a su contenido
   - **Anti-patrones** (qué NO funciona, con ejemplos)
   - **Observaciones adicionales**

Después del reporte, queda disponible para preguntas de seguimiento. Si el usuario quiere profundizar en un patrón, hazlo con ejemplos específicos del dataset.

Cuando cites un reel específico, usa el formato: @username (short_code) — views: X, eng: Y%

Comunícate siempre en español. Sé analítico pero práctico.`;

export const AGENTS: Record<string, AgentDefinition> = {
  hook: {
    type: "hook",
    name: "Hook Analyst",
    description: "Analiza patrones en la apertura de los reels: hook textual, verbal, visual y ángulo de entrada",
    icon: "🎣",
    briefingPrompt: HOOK_BRIEFING_PROMPT,
    analysisPrompt: HOOK_ANALYSIS_PROMPT,
  },
};

export function getAgent(type: string): AgentDefinition | null {
  return AGENTS[type] || null;
}

export function getAgentList(): AgentDefinition[] {
  return Object.values(AGENTS);
}

// ── Context Formatters ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatDatasetMetadata(metadata: any): string {
  if (!metadata) return "Dataset no encontrado.";

  const lines = [
    `=== METADATA DEL DATASET ===`,
    `Nombre: ${metadata.name}`,
  ];
  if (metadata.description) lines.push(`Descripción: ${metadata.description}`);
  if (metadata.context) lines.push(`Contexto: ${metadata.context}`);
  if (metadata.niche) lines.push(`Nicho: ${metadata.niche}`);
  if (metadata.objective) lines.push(`Objetivo: ${metadata.objective}`);
  if (metadata.tags?.length) lines.push(`Tags: ${metadata.tags.join(", ")}`);
  if (metadata.keywords?.length) lines.push(`Keywords: ${metadata.keywords.join(", ")}`);

  lines.push(`\nTotal de posts: ${metadata.total_posts}`);
  lines.push(`Total de creadores: ${metadata.total_creators}`);

  const m = metadata.metrics;
  if (m) {
    lines.push(`\n--- Métricas del dataset ---`);
    if (m.views?.median != null) lines.push(`Views: mediana ${m.views.median}, rango ${m.views.min} — ${m.views.max}`);
    if (m.likes?.median != null) lines.push(`Likes: mediana ${m.likes.median}, rango ${m.likes.min} — ${m.likes.max}`);
    if (m.comments?.median != null) lines.push(`Comments: mediana ${m.comments.median}, rango ${m.comments.min} — ${m.comments.max}`);
    if (m.engagement?.median != null) lines.push(`Engagement rate: mediana ${(m.engagement.median * 100).toFixed(2)}%, rango ${(m.engagement.min * 100).toFixed(2)}% — ${(m.engagement.max * 100).toFixed(2)}%`);
    if (m.duration?.median != null) lines.push(`Duración: mediana ${m.duration.median}s, rango ${m.duration.min}s — ${m.duration.max}s`);
  }

  if (metadata.creators?.length) {
    lines.push(`\n--- Creadores incluidos ---`);
    for (const c of metadata.creators) {
      lines.push(`@${c.username} (${c.followers} followers)`);
    }
  }

  lines.push(`=== FIN METADATA ===`);
  return lines.join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatDatasetFullContent(posts: any[]): string {
  if (!posts?.length) return "No hay posts con pre-análisis disponible en este dataset.";

  const lines = [`=== CONTENIDO COMPLETO DEL DATASET (${posts.length} posts) ===\n`];

  for (const p of posts) {
    lines.push(`--- POST: ${p.short_code} ---`);
    lines.push(`Creador: @${p.username} (${p.creator_followers} followers)`);
    lines.push(`Tipo: ${p.product_type || p.type}`);
    if (p.video_duration) lines.push(`Duración: ${p.video_duration}s`);
    lines.push(`Views: ${p.video_view_count || 0} | Likes: ${p.likes_count} | Comments: ${p.comments_count} | Shares: ${p.shares_count || 0}`);
    if (p.engagement_rate != null) lines.push(`Engagement: ${(p.engagement_rate * 100).toFixed(2)}%`);
    if (p.performance_score != null) lines.push(`Score: ${(p.performance_score * 100).toFixed(1)}`);
    if (p.hashtags?.length) lines.push(`Hashtags: ${p.hashtags.join(", ")}`);
    if (p.caption) lines.push(`Caption: ${p.caption.slice(0, 300)}`);
    if (p.posted_at) lines.push(`Publicado: ${p.posted_at}`);

    if (p.ai_analysis) {
      lines.push(`\nPre-análisis IA:`);
      lines.push(typeof p.ai_analysis === "string" ? p.ai_analysis : JSON.stringify(p.ai_analysis, null, 2));
    } else {
      lines.push(`Pre-análisis IA: no disponible`);
    }

    lines.push(""); // separator
  }

  lines.push(`=== FIN CONTENIDO ===`);
  return lines.join("\n");
}
