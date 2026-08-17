-- Migración 008: Sistema de Datasets
-- Colecciones curadas de posts con metadata contextual para análisis IA

-- ============================================================
-- DATASETS: Colecciones de posts creadas por el usuario
-- ============================================================
CREATE TABLE IF NOT EXISTS datasets (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    context TEXT,
    niche TEXT,
    objective TEXT,
    tags TEXT[] DEFAULT '{}',
    keywords TEXT[] DEFAULT '{}',
    additional_notes TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'analyzed', 'archived')),
    -- Métricas agregadas (se recalculan al agregar/quitar posts)
    total_posts INTEGER DEFAULT 0,
    total_creators INTEGER DEFAULT 0,
    median_views INTEGER,
    min_views INTEGER,
    max_views INTEGER,
    median_likes INTEGER,
    min_likes INTEGER,
    max_likes INTEGER,
    median_comments INTEGER,
    min_comments INTEGER,
    max_comments INTEGER,
    median_engagement REAL,
    min_engagement REAL,
    max_engagement REAL,
    median_duration REAL,
    min_duration REAL,
    max_duration REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DATASET_POSTS: Relación N:N entre datasets y posts
-- ============================================================
CREATE TABLE IF NOT EXISTS dataset_posts (
    dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    note TEXT,
    PRIMARY KEY (dataset_id, post_id)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_datasets_user ON datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_status ON datasets(status);
CREATE INDEX IF NOT EXISTS idx_dataset_posts_dataset ON dataset_posts(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_posts_post ON dataset_posts(post_id);
