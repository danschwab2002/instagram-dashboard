-- 018 — Control de concurrencia para el scraping de POSTS.
--
-- Analogo a lo que la 017 hizo para perfiles, pero en columnas separadas: una
-- cuenta puede tener el perfil ya scrapeado ('done') y los posts todavia
-- pendientes, asi que las dos etapas necesitan su propio estado.
--
-- `posts_scraped` y `last_updated_posts_scraped` ya las agrego la 017: son las
-- que usaba el WF3 de n8n como filtro de entrada
-- (WHERE scraped = TRUE AND posts_scraped = FALSE).

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS posts_scrape_status     TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS posts_scrape_started_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS posts_scrape_error      TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_posts_scrape_status_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_posts_scrape_status_check
      CHECK (posts_scrape_status IN ('pending', 'running', 'done', 'failed'));
  END IF;
END $$;

COMMENT ON COLUMN accounts.posts_scrape_status IS
  'Estado del claim de scraping de posts. running + posts_scrape_started_at viejo = worker muerto.';

-- Sostiene el claim del job: cuentas con perfil listo y posts pendientes.
CREATE INDEX IF NOT EXISTS idx_accounts_posts_pendientes_claim
  ON accounts (posts_scrape_status, posts_scrape_started_at)
  WHERE scraped = TRUE AND posts_scraped = FALSE;

COMMIT;
