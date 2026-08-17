-- Migración 007: Agregar scraped_by a posts
-- Asocia cada post al usuario que lo scrapeó, eliminando ambigüedad cuando
-- múltiples usuarios scrapean la misma cuenta

ALTER TABLE posts ADD COLUMN IF NOT EXISTS scraped_by UUID;
