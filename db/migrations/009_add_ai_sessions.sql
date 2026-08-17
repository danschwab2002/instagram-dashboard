-- Migración 009: AI Analysis Sessions y Messages
-- Sistema de chat con agentes IA especializados

-- ============================================================
-- AI_SESSIONS: Sesiones de análisis con agentes IA
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    agent_type TEXT NOT NULL DEFAULT 'hook',
    dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    tags TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed')),
    phase TEXT NOT NULL DEFAULT 'briefing'
        CHECK (phase IN ('briefing', 'analysis')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AI_MESSAGES: Historial de conversación persistente
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_messages (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_dataset ON ai_sessions(dataset_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_status ON ai_sessions(status);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session_created ON ai_messages(session_id, created_at);
