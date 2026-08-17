-- Migracion 017: Columnas de control de scraping en accounts
--
-- CONTEXTO: estas columnas existian en la instancia de produccion vieja pero
-- nunca quedaron en un archivo .sql — se agregaron a mano durante la sesion
-- del 2026-03-23 ("Reconstruccion del schema de DB" en el traceblog). Al
-- perderse esa instancia se perdieron con ella. Sin esto, /researches/[id]
-- falla en la primera query: pide a.scraped y a.posts_scraped.
--
-- Agrega ademas las columnas de control de concurrencia que el WF2 de n8n no
-- tenia, y que causaban que dos ejecuciones simultaneas scrapearan las mismas
-- cuentas dos veces (doble gasto de creditos de Apify).
--
-- NO se reintroduce accounts.instagram_url: era un artefacto del workflow que
-- guardaba el username con un nombre enganoso (el actor de Apify recibe
-- usernames, no URLs). El codigo nuevo usa accounts.username directo.

BEGIN;

-- ============================================================
-- 1. Flags de scraping (las que lee el frontend)
-- ============================================================
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS scraped BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS posts_scraped BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_updated_posts_scraped DATE;

COMMENT ON COLUMN accounts.scraped IS
  'TRUE cuando el perfil fue scrapeado con exito. Equivale a scrape_status = ''done''. '
  'Se resetea a FALSE cuando la cuenta entra en una investigacion nueva.';

-- ============================================================
-- 2. Control de concurrencia y diagnostico
--
-- scrape_status permite el claim atomico: un worker toma las cuentas
-- pendientes marcandolas 'running' en el mismo UPDATE que las selecciona,
-- asi dos corridas simultaneas nunca agarran la misma cuenta.
-- ============================================================
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS scrape_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS scrape_started_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS scrape_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_scrape_status_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_scrape_status_check
      CHECK (scrape_status IN ('pending', 'running', 'done', 'failed'));
  END IF;
END $$;

COMMENT ON COLUMN accounts.scrape_status IS
  'pending = sin scrapear | running = reclamada por un worker | done = ok | failed = ver scrape_error';
COMMENT ON COLUMN accounts.scrape_started_at IS
  'Cuando un worker reclamo la cuenta. Sirve para recuperar claims huerfanos '
  '(proceso que murio a mitad de corrida) pasado un timeout.';

-- ============================================================
-- 3. Indices
-- ============================================================
-- El claim filtra por scraped = FALSE, asi que el indice parcial cubre
-- exactamente esa query y se mantiene chico a medida que la tabla crece.
CREATE INDEX IF NOT EXISTS idx_accounts_pendientes
  ON accounts (scrape_status, scrape_started_at)
  WHERE scraped = FALSE;

CREATE INDEX IF NOT EXISTS idx_accounts_posts_pendientes
  ON accounts (posts_scraped)
  WHERE scraped = TRUE AND posts_scraped = FALSE;

-- ============================================================
-- 4. Consistencia hacia atras
-- ============================================================
-- Filas que ya tenian datos de perfil cargados de antes quedan como 'done'.
UPDATE accounts
   SET scrape_status = 'done',
       scraped = TRUE
 WHERE scraped = TRUE
   AND scrape_status = 'pending';

COMMIT;
