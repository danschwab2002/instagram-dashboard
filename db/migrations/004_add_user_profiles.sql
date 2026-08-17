-- Migración 004: Tabla de perfiles de usuario
-- Almacena configuración por usuario (API keys, preferencias)

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY,
    apify_api_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
