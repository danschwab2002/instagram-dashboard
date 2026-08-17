-- Migration 013: Metricas calculadas para contenido propio (ig_media)
-- Agrega engagement_rate, performance_score y outlier scores a ig_media.
-- Recicla la logica de posts scrapeados pero adaptada:
--   - Engagement incluye saves (dato exclusivo de cuenta propia)
--   - Performance score usa views (comparable con competidores)
--   - Outlier scores son por ig_connection (cuenta propia)

BEGIN;

-- ============================================================
-- 1. Nuevas columnas en ig_media
-- ============================================================
ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS engagement_rate REAL;
ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS performance_score REAL;
ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS outlier_views REAL;
ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS outlier_engagement REAL;
ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS outlier_confidence TEXT DEFAULT 'high';
ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS outlier_confidence_score REAL DEFAULT 1.0;

-- ============================================================
-- 2. Indices para sorting/filtering
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ig_media_engagement ON ig_media(engagement_rate DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ig_media_performance ON ig_media(performance_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ig_media_outlier_views ON ig_media(outlier_views DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ig_media_outlier_engagement ON ig_media(outlier_engagement DESC NULLS LAST);

-- ============================================================
-- 3. calculate_ig_engagement_rates()
--
-- Formula: (likes + comments + saves + shares) / followers
-- Diferencia vs posts scrapeados: incluye saves (dato real de API)
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_ig_engagement_rates()
RETURNS void AS $$
BEGIN
  UPDATE ig_media m SET
    engagement_rate = CASE
      WHEN c.ig_followers_count > 0 THEN
        (COALESCE(m.like_count, 0) + COALESCE(m.comments_count, 0)
         + COALESCE(m.saves, 0) + COALESCE(m.shares, 0))::REAL
        / c.ig_followers_count
      ELSE 0
    END
  FROM ig_connections c
  WHERE c.id = m.ig_connection_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. calculate_ig_performance_scores()
--
-- Videos/Reels: normalized_views * 0.6 + engagement_rate * 0.4
-- Otros: engagement_rate puro
-- Usa views (comparable con competidores, decision del usuario)
-- Normaliza min-max POR CONEXION (no global)
-- Requiere: engagement_rate ya calculado
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_ig_performance_scores()
RETURNS void AS $$
BEGIN
  WITH conn_stats AS (
    SELECT
      ig_connection_id,
      MIN(views) as min_views,
      MAX(views) as max_views
    FROM ig_media
    WHERE views IS NOT NULL AND views > 0
    GROUP BY ig_connection_id
  )
  UPDATE ig_media m SET
    performance_score = CASE
      WHEN m.views IS NOT NULL AND m.views > 0 AND cs.max_views > cs.min_views THEN
        (CAST(m.views - cs.min_views AS REAL) / (cs.max_views - cs.min_views)) * 0.6
        + COALESCE(m.engagement_rate, 0) * 0.4
      ELSE
        COALESCE(m.engagement_rate, 0)
    END
  FROM conn_stats cs
  WHERE cs.ig_connection_id = m.ig_connection_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. calculate_ig_outlier_scores()
--
-- Misma formula que posts scrapeados pero por ig_connection:
--   outlier_views = (views / avg_views) * LN(avg_views + 1)
--   outlier_engagement = (engagement / avg_engagement) * LN(avg_views + 1)
--
-- Confianza siempre alta para cuenta propia (acceso completo)
-- pero se calcula igual para consistencia con el dashboard
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_ig_outlier_scores()
RETURNS void AS $$
BEGIN
  WITH conn_stats AS (
    SELECT
      ig_connection_id,
      AVG(views) FILTER (
        WHERE views IS NOT NULL AND views > 0
      ) as avg_views,
      AVG(engagement_rate) FILTER (
        WHERE engagement_rate IS NOT NULL AND engagement_rate > 0
      ) as avg_engagement,
      COUNT(*)::int as posts_count
    FROM ig_media
    GROUP BY ig_connection_id
  )
  UPDATE ig_media m SET
    outlier_views = CASE
      WHEN cs.avg_views > 0 AND m.views IS NOT NULL AND m.views > 0
      THEN (m.views::real / cs.avg_views) * LN(cs.avg_views + 1)
      ELSE NULL
    END,
    outlier_engagement = CASE
      WHEN cs.avg_engagement > 0 AND m.engagement_rate IS NOT NULL AND m.engagement_rate > 0
      THEN (m.engagement_rate / cs.avg_engagement) * LN(cs.avg_views + 1)
      ELSE NULL
    END,
    outlier_confidence = CASE
      WHEN cs.posts_count >= 30 THEN 'high'
      WHEN cs.posts_count >= 10 THEN 'medium'
      ELSE 'low'
    END,
    outlier_confidence_score = LEAST(cs.posts_count::real / 30.0, 1.0)
  FROM conn_stats cs
  WHERE cs.ig_connection_id = m.ig_connection_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. run_ig_full_scoring()
-- Conveniencia: ejecuta las 3 funciones en secuencia.
-- Llamar desde WF-IG4 despues de actualizar metricas.
-- ============================================================
CREATE OR REPLACE FUNCTION run_ig_full_scoring()
RETURNS void AS $$
BEGIN
  PERFORM calculate_ig_engagement_rates();
  PERFORM calculate_ig_performance_scores();
  PERFORM calculate_ig_outlier_scores();
END;
$$ LANGUAGE plpgsql;

COMMIT;
