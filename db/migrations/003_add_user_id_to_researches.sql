-- Migración 003: Agregar user_id a researches para multi-usuario
-- Usa el UUID de Supabase Auth (auth.users.id)

ALTER TABLE researches ADD COLUMN IF NOT EXISTS user_id UUID;

-- Index para filtrar investigaciones por usuario
CREATE INDEX IF NOT EXISTS idx_researches_user_id ON researches(user_id);
