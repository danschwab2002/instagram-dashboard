-- Migration 001: Agregar campos del actor apidojo/instagram-scraper-api
-- Ejecutar en Supabase SQL Editor
-- Fecha: 2026-03-21

-- Nuevos campos para posts (Video/Reel)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_play_count INTEGER;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS shares_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_paid_partnership BOOLEAN DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS transcript TEXT;
