-- Migration 016: Soporte completo para Stories
-- Las tablas ig_media e ig_media_metrics ya tienen la mayoria de columnas necesarias.
-- Solo falta: impressions (total veces mostrada, distinto a reach que es usuarios unicos)
-- y un indice para consultar stories activas eficientemente.

-- 1. Columna impressions en ig_media (metricas actuales denormalizadas)
ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS impressions INTEGER;

-- 2. Columna impressions en ig_media_metrics (snapshots historicos)
ALTER TABLE ig_media_metrics ADD COLUMN IF NOT EXISTS impressions INTEGER;

-- 3. Indice para stories activas (no expiradas)
CREATE INDEX IF NOT EXISTS idx_ig_media_active_stories
ON ig_media(ig_connection_id, published_at DESC)
WHERE media_product_type = 'STORY' AND is_story_expired = false;

-- 4. Indice para stories expiradas (historial)
CREATE INDEX IF NOT EXISTS idx_ig_media_expired_stories
ON ig_media(ig_connection_id, published_at DESC)
WHERE media_product_type = 'STORY' AND is_story_expired = true;
