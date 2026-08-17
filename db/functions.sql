-- Instagram Scraper & Analyzer - PostgreSQL Functions (Supabase)
-- Ejecutar en Supabase SQL Editor
-- Actualizado 2026-03-21 para actor apidojo/instagram-scraper-api

-- ============================================================
-- FUNCIÓN 1: upsert_post_hashtags
-- Recibe un post_id y array de hashtags, inserta y relaciona.
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_post_hashtags(p_post_id BIGINT, p_tags TEXT[])
RETURNS void AS $$
DECLARE
  v_tag TEXT;
  v_id BIGINT;
BEGIN
  FOREACH v_tag IN ARRAY p_tags LOOP
    INSERT INTO hashtags (tag) VALUES (lower(v_tag))
    ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag
    RETURNING id INTO v_id;

    INSERT INTO post_hashtags (post_id, hashtag_id) VALUES (p_post_id, v_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN 2: upsert_post_mentions
-- Recibe un post_id y array de usernames, inserta y relaciona.
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_post_mentions(p_post_id BIGINT, p_usernames TEXT[])
RETURNS void AS $$
DECLARE
  v_uname TEXT;
  v_id BIGINT;
BEGIN
  FOREACH v_uname IN ARRAY p_usernames LOOP
    INSERT INTO mentions (username) VALUES (lower(v_uname))
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
    RETURNING id INTO v_id;

    INSERT INTO post_mentions (post_id, mention_id) VALUES (p_post_id, v_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN 3: calculate_engagement_rates
-- Calcula engagement_rate para posts que aún no lo tienen.
-- Formula (DEC-002): (likes + comments + shares) / followers
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_engagement_rates()
RETURNS void AS $$
BEGIN
  UPDATE posts p
  SET engagement_rate = CASE
    WHEN a.followers_count > 0 THEN
      (COALESCE(p.likes_count, 0) + COALESCE(p.comments_count, 0) + COALESCE(p.shares_count, 0))::REAL
      / a.followers_count
    ELSE 0
    END
  FROM accounts a
  WHERE p.account_id = a.id
    AND p.engagement_rate IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN 4: calculate_performance_scores
-- Normaliza video views (min-max) y calcula performance_score
-- para posts que aún no lo tienen.
-- Videos: normalized_views * 0.6 + engagement_rate * 0.4
-- Fotos/Sidecar: engagement_rate puro
-- Requiere que engagement_rate ya esté calculado.
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_performance_scores()
RETURNS void AS $$
BEGIN
  WITH stats AS (
    SELECT
      MIN(video_view_count) as min_views,
      MAX(video_view_count) as max_views
    FROM posts
    WHERE type = 'Video'
      AND video_view_count IS NOT NULL
  )
  UPDATE posts p
  SET performance_score = CASE
    WHEN p.type = 'Video' AND p.video_view_count IS NOT NULL AND s.max_views > s.min_views THEN
      (CAST(p.video_view_count - s.min_views AS REAL) /
       (s.max_views - s.min_views)) * 0.6
      + COALESCE(p.engagement_rate, 0) * 0.4
    WHEN p.type = 'Video' AND p.video_view_count IS NOT NULL THEN
      COALESCE(p.engagement_rate, 0)
    ELSE
      COALESCE(p.engagement_rate, 0)
    END
  FROM stats s
  WHERE p.performance_score IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN 5: run_full_scoring
-- Conveniencia: ejecuta engagement_rates + performance_scores en secuencia.
-- ============================================================
CREATE OR REPLACE FUNCTION run_full_scoring()
RETURNS void AS $$
BEGIN
  PERFORM calculate_engagement_rates();
  PERFORM calculate_performance_scores();
END;
$$ LANGUAGE plpgsql;
