-- Migración 002: Tablas de Investigaciones
-- Permite agrupar cuentas bajo una "investigación" para organizar búsquedas

-- ============================================================
-- RESEARCHES: Agrupaciones de cuentas para investigación
-- ============================================================
CREATE TABLE IF NOT EXISTS researches (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scraping', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RESEARCH_ACCOUNTS: Relación N:N entre investigaciones y cuentas
-- ============================================================
CREATE TABLE IF NOT EXISTS research_accounts (
    research_id BIGINT NOT NULL REFERENCES researches(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (research_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_research_accounts_research ON research_accounts(research_id);
CREATE INDEX IF NOT EXISTS idx_research_accounts_account ON research_accounts(account_id);
