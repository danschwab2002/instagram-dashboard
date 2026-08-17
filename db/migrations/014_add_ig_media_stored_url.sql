-- Migration 014: URL permanente de video para ig_media
-- Misma logica que posts scrapeados: descargar video y guardar en Supabase Storage

ALTER TABLE ig_media ADD COLUMN IF NOT EXISTS stored_url TEXT;
