-- Migración 005: Agregar days_back a researches
-- Permite que cada investigación defina cuántos días hacia atrás scrapear

ALTER TABLE researches ADD COLUMN IF NOT EXISTS days_back INTEGER NOT NULL DEFAULT 30;
