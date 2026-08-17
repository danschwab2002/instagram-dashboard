-- Migración 010: Agregar soporte multi-proveedor de IA
-- Campos para OpenAI y Claude API keys + selector de proveedor activo

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS openai_api_key TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS claude_api_key TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai'
    CHECK (ai_provider IN ('openai', 'gemini', 'claude'));
