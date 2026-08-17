-- Migration 015: Guardar followers_count en cada sync diario
-- Permite calcular follows_net de forma independiente (sin race condition con WF-IG4)

ALTER TABLE ig_account_daily_metrics
ADD COLUMN IF NOT EXISTS followers_count_at_sync INTEGER;
