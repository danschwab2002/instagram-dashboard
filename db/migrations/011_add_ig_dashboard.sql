-- Migration 011: Instagram Dashboard - Own Account via Meta Graph API
-- Adds 8 tables for managing connected Instagram accounts, their media,
-- metrics, demographics, webhooks, sync logs, and dataset integration.
-- All tables prefixed with ig_ to distinguish from existing scraping tables.

BEGIN;

-- ============================================================
-- 1. ig_connections — Cuentas propias conectadas via OAuth
-- ============================================================
CREATE TABLE ig_connections (
    id                      BIGSERIAL PRIMARY KEY,
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ig_account_id           TEXT NOT NULL UNIQUE,
    fb_page_id              TEXT NOT NULL,
    page_access_token       TEXT NOT NULL,
    ig_username             TEXT NOT NULL,
    ig_name                 TEXT,
    ig_profile_picture_url  TEXT,
    ig_followers_count      INTEGER DEFAULT 0,
    ig_following_count      INTEGER DEFAULT 0,
    ig_media_count          INTEGER DEFAULT 0,
    ig_biography            TEXT,
    ig_website              TEXT,
    ig_account_type         TEXT,
    scopes                  TEXT[] DEFAULT '{}',
    is_active               BOOLEAN DEFAULT TRUE,
    connected_at            TIMESTAMPTZ DEFAULT NOW(),
    last_synced_at          TIMESTAMPTZ,
    last_verified_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ig_connections_user_id ON ig_connections(user_id);

-- ============================================================
-- 2. ig_media — Publicaciones propias con metricas actuales
-- ============================================================
CREATE TABLE ig_media (
    id                      BIGSERIAL PRIMARY KEY,
    ig_connection_id        BIGINT NOT NULL REFERENCES ig_connections(id) ON DELETE CASCADE,
    ig_media_id             TEXT NOT NULL UNIQUE,
    media_type              TEXT NOT NULL,
    media_product_type      TEXT,
    caption                 TEXT,
    permalink               TEXT,
    media_url               TEXT,
    thumbnail_url           TEXT,
    published_at            TIMESTAMPTZ,

    -- Story fields
    is_story_expired        BOOLEAN DEFAULT FALSE,
    story_expires_at        TIMESTAMPTZ,

    -- Metricas actuales denormalizadas (se sobreescriben en cada sync)
    like_count              INTEGER DEFAULT 0,
    comments_count          INTEGER DEFAULT 0,
    reach                   INTEGER,
    views                   INTEGER,
    saves                   INTEGER,
    shares                  INTEGER,
    total_interactions       INTEGER,
    follows                 INTEGER,
    profile_visits          INTEGER,

    -- Exclusivas de Reels
    ig_reels_avg_watch_time         REAL,
    ig_reels_video_view_total_time  BIGINT,
    skip_rate               REAL,

    -- Exclusivas de Stories
    navigation_tap_forward  INTEGER,
    navigation_tap_back     INTEGER,
    navigation_tap_exit     INTEGER,
    replies                 INTEGER,

    -- Puente con posts scrapeados
    linked_post_id          BIGINT REFERENCES posts(id) ON DELETE SET NULL,

    -- Flexibilidad futura
    extra_metrics           JSONB DEFAULT '{}',
    api_response_raw        JSONB,

    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ig_media_connection ON ig_media(ig_connection_id);
CREATE INDEX idx_ig_media_published ON ig_media(ig_connection_id, published_at DESC);
CREATE INDEX idx_ig_media_reach ON ig_media(ig_connection_id, reach DESC NULLS LAST);
CREATE INDEX idx_ig_media_product_type ON ig_media(ig_connection_id, media_product_type);

-- ============================================================
-- 3. ig_media_metrics — Snapshots historicos (curvas de crecimiento)
-- ============================================================
CREATE TABLE ig_media_metrics (
    id                      BIGSERIAL PRIMARY KEY,
    ig_media_ref            BIGINT NOT NULL REFERENCES ig_media(id) ON DELETE CASCADE,
    reach                   INTEGER,
    views                   INTEGER,
    likes                   INTEGER,
    comments                INTEGER,
    saves                   INTEGER,
    shares                  INTEGER,
    total_interactions       INTEGER,
    follows                 INTEGER,
    profile_visits          INTEGER,
    ig_reels_avg_watch_time         REAL,
    ig_reels_video_view_total_time  BIGINT,
    skip_rate               REAL,
    navigation_tap_forward  INTEGER,
    navigation_tap_back     INTEGER,
    navigation_tap_exit     INTEGER,
    replies                 INTEGER,
    account_followers_at_sync INTEGER,
    captured_via            TEXT DEFAULT 'api' CHECK (captured_via IN ('api', 'webhook')),
    extra_metrics           JSONB DEFAULT '{}',
    api_response_raw        JSONB,
    synced_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ig_media_metrics_latest ON ig_media_metrics(ig_media_ref, synced_at DESC);

-- ============================================================
-- 4. ig_account_daily_metrics — Metricas de cuenta por dia
-- ============================================================
CREATE TABLE ig_account_daily_metrics (
    id                      BIGSERIAL PRIMARY KEY,
    ig_connection_id        BIGINT NOT NULL REFERENCES ig_connections(id) ON DELETE CASCADE,
    metric_date             DATE NOT NULL,

    -- Metricas core (columnas planas para queries directos)
    reach                   INTEGER,
    views                   INTEGER,
    accounts_engaged        INTEGER,
    total_interactions       INTEGER,
    likes                   INTEGER,
    comments                INTEGER,
    shares                  INTEGER,
    saves                   INTEGER,
    replies                 INTEGER,
    reposts                 INTEGER,
    follows                 INTEGER,
    unfollows               INTEGER,
    follows_net             INTEGER,
    profile_links_taps      INTEGER,

    -- Breakdowns variables (JSONB para flexibilidad)
    breakdowns              JSONB DEFAULT '{}',

    api_response_raw        JSONB,
    synced_at               TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (ig_connection_id, metric_date)
);

CREATE INDEX idx_ig_daily_metrics_date ON ig_account_daily_metrics(ig_connection_id, metric_date DESC);

-- ============================================================
-- 5. ig_audience_demographics — Demograficos (mensual)
-- ============================================================
CREATE TABLE ig_audience_demographics (
    id                      BIGSERIAL PRIMARY KEY,
    ig_connection_id        BIGINT NOT NULL REFERENCES ig_connections(id) ON DELETE CASCADE,
    demographic_type        TEXT NOT NULL,
    timeframe               TEXT NOT NULL DEFAULT 'last_30_days',
    breakdown               TEXT NOT NULL,
    dimension_value         TEXT NOT NULL,
    count                   INTEGER NOT NULL DEFAULT 0,
    captured_at             DATE NOT NULL,
    api_response_raw        JSONB,
    synced_at               TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (ig_connection_id, demographic_type, breakdown, dimension_value, captured_at)
);

CREATE INDEX idx_ig_demographics_captured ON ig_audience_demographics(ig_connection_id, captured_at DESC);

-- ============================================================
-- 6. ig_webhook_events — Payload crudo de webhooks de Meta
-- ============================================================
CREATE TABLE ig_webhook_events (
    id                      BIGSERIAL PRIMARY KEY,
    ig_account_id           TEXT NOT NULL,
    event_type              TEXT NOT NULL,
    payload_raw             JSONB NOT NULL,
    processed               BOOLEAN DEFAULT FALSE,
    processed_at            TIMESTAMPTZ,
    error_message           TEXT,
    received_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ig_webhook_unprocessed ON ig_webhook_events(processed) WHERE processed = FALSE;

-- ============================================================
-- 7. ig_sync_log — Auditoria de sincronizaciones
-- ============================================================
CREATE TABLE ig_sync_log (
    id                      BIGSERIAL PRIMARY KEY,
    ig_connection_id        BIGINT REFERENCES ig_connections(id) ON DELETE SET NULL,
    sync_type               TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'failed', 'partial')),
    records_processed       INTEGER DEFAULT 0,
    records_failed          INTEGER DEFAULT 0,
    date_from               DATE,
    date_to                 DATE,
    error_message           TEXT,
    details                 JSONB,
    started_at              TIMESTAMPTZ DEFAULT NOW(),
    completed_at            TIMESTAMPTZ
);

CREATE INDEX idx_ig_sync_log_connection ON ig_sync_log(ig_connection_id);
CREATE INDEX idx_ig_sync_log_type ON ig_sync_log(sync_type, started_at DESC);

-- ============================================================
-- 8. dataset_ig_media — Puente entre datasets y contenido propio
-- ============================================================
CREATE TABLE dataset_ig_media (
    dataset_id              BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    ig_media_id             BIGINT NOT NULL REFERENCES ig_media(id) ON DELETE CASCADE,
    added_at                TIMESTAMPTZ DEFAULT NOW(),
    note                    TEXT,
    PRIMARY KEY (dataset_id, ig_media_id)
);

CREATE INDEX idx_dataset_ig_media_dataset ON dataset_ig_media(dataset_id);
CREATE INDEX idx_dataset_ig_media_media ON dataset_ig_media(ig_media_id);

COMMIT;
