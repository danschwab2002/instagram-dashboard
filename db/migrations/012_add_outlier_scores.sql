-- Migration 012: Outlier Scores for scraped posts
-- Adds outlier_views and outlier_engagement scores per post,
-- calculated relative to the creator's historical average,
-- weighted by creator volume (logarithmic).

BEGIN;

-- ============================================================
-- 1. New columns on posts table
-- ============================================================
ALTER TABLE posts ADD COLUMN IF NOT EXISTS outlier_views REAL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS outlier_engagement REAL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS outlier_confidence TEXT DEFAULT 'low';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS outlier_confidence_score REAL DEFAULT 0;

-- ============================================================
-- 2. Indexes for sorting/filtering by outlier scores
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_posts_outlier_views ON posts(outlier_views DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_posts_outlier_engagement ON posts(outlier_engagement DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_posts_outlier_confidence ON posts(outlier_confidence);

-- ============================================================
-- 3. Function: calculate_outlier_scores()
--
-- For each post, calculates:
--   outlier_views = (post_views / avg_views_of_creator) * LN(avg_views_of_creator + 1)
--   outlier_engagement = (post_engagement / avg_engagement_of_creator) * LN(avg_views_of_creator + 1)
--
-- The LN(avg_views) multiplier gives more weight to outliers
-- from creators with larger audiences (logarithmic scale).
--
-- Confidence is based on how many posts we have for that creator:
--   < 10 posts  = 'low'
--   10-29 posts = 'medium'
--   >= 30 posts = 'high'
--
-- Depends on: engagement_rate must be calculated first
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_outlier_scores()
RETURNS void AS $$
BEGIN
  WITH creator_stats AS (
    SELECT
      account_id,
      AVG(video_view_count) FILTER (
        WHERE video_view_count IS NOT NULL AND video_view_count > 0
      ) as avg_views,
      AVG(engagement_rate) FILTER (
        WHERE engagement_rate IS NOT NULL AND engagement_rate > 0
      ) as avg_engagement,
      COUNT(*)::int as posts_count
    FROM posts
    GROUP BY account_id
  )
  UPDATE posts p SET
    outlier_views = CASE
      WHEN cs.avg_views > 0 AND p.video_view_count IS NOT NULL AND p.video_view_count > 0
      THEN (p.video_view_count::real / cs.avg_views) * LN(cs.avg_views + 1)
      ELSE NULL
    END,
    outlier_engagement = CASE
      WHEN cs.avg_engagement > 0 AND p.engagement_rate IS NOT NULL AND p.engagement_rate > 0
      THEN (p.engagement_rate / cs.avg_engagement) * LN(cs.avg_views + 1)
      ELSE NULL
    END,
    outlier_confidence = CASE
      WHEN cs.posts_count >= 30 THEN 'high'
      WHEN cs.posts_count >= 10 THEN 'medium'
      ELSE 'low'
    END,
    outlier_confidence_score = LEAST(cs.posts_count::real / 30.0, 1.0)
  FROM creator_stats cs
  WHERE cs.account_id = p.account_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
