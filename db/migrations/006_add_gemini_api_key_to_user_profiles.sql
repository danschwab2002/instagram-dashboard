-- Migración 006: Agregar gemini_api_key a user_profiles
-- Permite que cada usuario configure su propia API key de Gemini para deep analysis

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;
