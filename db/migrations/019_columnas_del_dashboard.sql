-- 019 — Columnas y tabla que el frontend consulta pero ningun .sql creaba.
--
-- Se perdieron en el incidente del 2026-03-23 (la DB se reconstruyo a mano y
-- estas quedaron afuera). Sin ellas `getPosts()` — la query principal del
-- dashboard — falla con "column p.stored_url does not exist", aunque el
-- scraping funcione perfecto.
--
-- Las 8 columnas salen del traceblog (WF3b + pipeline de analisis) y coinciden
-- con los tipos declarados en app/lib/db.ts.
--
-- NO se crea `post_analyses`: el traceblog la menciona como diseño pero ningun
-- archivo del frontend la consulta, y su forma exacta depende de que devuelva
-- el analisis con Gemini. Se define cuando se porte esa etapa, no antes.

BEGIN;

-- ── WF3b: descarga de videos ────────────────────────────────
-- URL del CDN de Instagram; caduca en horas (LES-005), por eso se guarda copia.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_url  TEXT;
-- URL permanente de la copia en el storage propio.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS stored_url TEXT;

-- ── Pipeline de analisis: ffmpeg → whisper → LLM ────────────
ALTER TABLE posts ADD COLUMN IF NOT EXISTS whisper_transcript   TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS transcription_status TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS frames_extracted     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS frames_count         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS analysis_status      TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS analyzed_at          TIMESTAMPTZ;

COMMENT ON COLUMN posts.video_url IS
  'URL del CDN de Instagram. Caduca en horas: hay que descargar rapido (LES-005).';
COMMENT ON COLUMN posts.stored_url IS
  'URL permanente de la copia propia del video. La consulta el dashboard.';

-- Sostiene la cola de WF3b: videos bajados de Apify sin copia propia todavia.
CREATE INDEX IF NOT EXISTS idx_posts_video_pendiente
  ON posts (id) WHERE video_url IS NOT NULL AND stored_url IS NULL;

-- ── Descripciones generadas por IA ──────────────────────────
-- Historico: se guarda una fila por corrida y se lee la mas reciente
-- (ORDER BY created_at DESC LIMIT 1 en db.ts y en /api/posts/[id]/analysis).
CREATE TABLE IF NOT EXISTS post_descriptions (
  id          BIGSERIAL PRIMARY KEY,
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  description TEXT   NOT NULL,
  model_used  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_descriptions_post
  ON post_descriptions (post_id, created_at DESC);

COMMIT;
