-- Instagram Scraper & Analyzer - PostgreSQL Schema (Supabase)

-- ============================================================
-- ACCOUNTS: Cuentas de Instagram que trackeamos
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
    id BIGSERIAL PRIMARY KEY,
    instagram_id TEXT UNIQUE,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT,
    biography TEXT,
    external_url TEXT,
    followers_count INTEGER DEFAULT 0,
    follows_count INTEGER DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    is_business_account BOOLEAN DEFAULT FALSE,
    business_category TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    is_private BOOLEAN DEFAULT FALSE,
    profile_pic_url TEXT,
    account_type TEXT NOT NULL DEFAULT 'competitor' CHECK (account_type IN ('own', 'competitor')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- POSTS: Posts, reels, carruseles scrapeados
-- ============================================================
CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    instagram_id TEXT UNIQUE,
    short_code TEXT NOT NULL UNIQUE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    url TEXT,
    type TEXT NOT NULL CHECK (type IN ('Image', 'Video', 'Sidecar')),
    caption TEXT,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    video_view_count INTEGER,
    video_play_count INTEGER,
    video_duration REAL,
    shares_count INTEGER DEFAULT 0,
    display_url TEXT,
    dimensions_width INTEGER,
    dimensions_height INTEGER,
    location_name TEXT,
    location_id TEXT,
    is_advertisement BOOLEAN DEFAULT FALSE,
    is_paid_partnership BOOLEAN DEFAULT FALSE,
    comments_disabled BOOLEAN DEFAULT FALSE,
    caption_is_edited BOOLEAN DEFAULT FALSE,
    product_type TEXT,
    transcript TEXT,
    posted_at TIMESTAMPTZ,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    engagement_rate REAL,
    performance_score REAL
);

-- ============================================================
-- HASHTAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS hashtags (
    id BIGSERIAL PRIMARY KEY,
    tag TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_hashtags (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    hashtag_id BIGINT NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, hashtag_id)
);

-- ============================================================
-- MENTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS mentions (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_mentions (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    mention_id BIGINT NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, mention_id)
);

-- ============================================================
-- COMMENTS (para análisis futuro)
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    instagram_id TEXT UNIQUE,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    text TEXT,
    owner_username TEXT,
    owner_id TEXT,
    owner_is_verified BOOLEAN DEFAULT FALSE,
    position INTEGER,
    commented_at TIMESTAMPTZ,
    scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TAGGED USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS tagged_users (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    UNIQUE (post_id, username)
);

-- ============================================================
-- SCRAPE RUNS (auditoría)
-- ============================================================
CREATE TABLE IF NOT EXISTS scrape_runs (
    id BIGSERIAL PRIMARY KEY,
    run_type TEXT NOT NULL CHECK (run_type IN ('profiles', 'posts', 'comments')),
    accounts_targeted JSONB,
    posts_scraped INTEGER DEFAULT 0,
    profiles_scraped INTEGER DEFAULT 0,
    comments_scraped INTEGER DEFAULT 0,
    apify_run_id TEXT,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

-- ============================================================
-- ACCOUNT SNAPSHOTS (historial semanal)
-- ============================================================
CREATE TABLE IF NOT EXISTS account_snapshots (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    followers_count INTEGER,
    follows_count INTEGER,
    posts_count INTEGER,
    snapshot_date DATE NOT NULL,
    UNIQUE (account_id, snapshot_date)
);

-- ============================================================
-- CHILD POSTS (media dentro de carruseles)
-- ============================================================
CREATE TABLE IF NOT EXISTS child_posts (
    id BIGSERIAL PRIMARY KEY,
    parent_post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    position INTEGER,
    type TEXT CHECK (type IN ('Image', 'Video')),
    display_url TEXT,
    dimensions_width INTEGER,
    dimensions_height INTEGER,
    video_view_count INTEGER,
    video_duration REAL
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id);
CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_posts_performance ON posts(performance_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
CREATE INDEX IF NOT EXISTS idx_posts_short_code ON posts(short_code);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_account ON account_snapshots(account_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_status ON scrape_runs(status);
CREATE INDEX IF NOT EXISTS idx_child_posts_parent ON child_posts(parent_post_id);
