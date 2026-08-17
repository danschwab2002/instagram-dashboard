import { pool, withTransaction } from "../pool";
import { ApifyAuthError, ApifyPaymentError } from "../apify/client";
import {
  scrapeProfile,
  ProfileNotFoundError,
  type AccountProfile,
} from "../apify/profile-scraper";
import { mapWithConcurrency, isAbort, describeError as describeErrorBase } from "./shared";

/**
 * Reemplazo en codigo del workflow "WF2 - IG Scrape Profiles" de n8n.
 *
 * Diferencias deliberadas con el workflow original, todas correcciones de
 * defectos verificados en n8n-workflows/wf2-scrape-profiles.json:
 *
 *  1. Trabaja sobre las cuentas DE UNA INVESTIGACION. El WF2 barria
 *     `accounts WHERE scraped = FALSE` global, asi que el run de un usuario
 *     scrapeaba las cuentas de otro gastando su propio credito de Apify.
 *  2. Usa el token del usuario. El WF2 lo tenia hardcodeado en la URL del nodo
 *     y nunca leia el `apify_api_key` del payload (DEC-024 quedo pendiente).
 *  3. Claim atomico. Dos corridas simultaneas del WF2 leian el mismo
 *     `scraped = FALSE` y scrapeaban lo mismo dos veces.
 *  4. Una cuenta que falla no corta la corrida: queda marcada y el resto sigue.
 *     El WF2 no tenia rama de error, asi que dejaba `scrape_runs` en 'running'
 *     y la investigacion en 'scraping' para siempre.
 *  5. `profiles_scraped` guarda un entero. El WF2 escribia un string de
 *     usernames concatenados en una columna INTEGER.
 *  6. Escribe `external_url`, `profile_pic_url` y `follows_count`, que el WF2
 *     no mapeaba (por eso el dashboard nunca mostro fotos de perfil).
 */

/** Un claim mas viejo que esto se considera huerfano: el worker murio. */
const CLAIM_TIMEOUT_MINUTES = 15;

/** Apify tolera bastante mas, pero de a 3 el gasto es facil de seguir. */
const DEFAULT_CONCURRENCY = 3;

export interface ScrapeProfilesOptions {
  /** Token de Apify. Si se omite se resuelve desde el dueno de la investigacion. */
  apifyToken?: string;
  concurrency?: number;
  signal?: AbortSignal;
  /** Vuelve a scrapear cuentas ya marcadas como `scraped`. */
  force?: boolean;
}

export interface ScrapeProfilesResult {
  researchId: number;
  /** null si no habia nada para scrapear (no se abre run). */
  runId: number | null;
  claimed: number;
  succeeded: number;
  failed: number;
  /** Reclamadas pero nunca procesadas por un aborto. Vuelven a 'pending'. */
  skipped: number;
  failures: Array<{ username: string; error: string }>;
}

interface ClaimedAccount {
  id: number;
  username: string;
}

export async function scrapeProfilesForResearch(
  researchId: number,
  options: ScrapeProfilesOptions = {}
): Promise<ScrapeProfilesResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const token = options.apifyToken ?? (await resolveApifyToken(researchId));

  if (!token) {
    throw new Error(
      `La investigacion ${researchId} no tiene token de Apify: cargalo en /settings ` +
        `o defini APIFY_TOKEN en el entorno.`
    );
  }

  const claimed = await claimPendingAccounts(researchId, options.force ?? false);
  if (claimed.length === 0) {
    return {
      researchId,
      runId: null,
      claimed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    };
  }

  const runId = await openScrapeRun(claimed.map((a) => a.username));

  // Un token invalido o una cuenta sin creditos rompen TODAS las cuentas por
  // igual: se aborta la corrida en vez de quemar 20 requests condenados.
  const fatalController = new AbortController();
  let fatalError: Error | undefined;

  const signal = options.signal
    ? AbortSignal.any([options.signal, fatalController.signal])
    : fatalController.signal;

  const failures: ScrapeProfilesResult["failures"] = [];
  let succeeded = 0;

  await mapWithConcurrency(claimed, concurrency, async (account) => {
    if (signal.aborted) return;

    try {
      const profile = await scrapeProfile(account.username, { token, signal });
      await persistProfile(account.id, profile);
      succeeded++;
    } catch (error) {
      if (isAbort(error)) return;

      if (error instanceof ApifyAuthError || error instanceof ApifyPaymentError) {
        fatalError ??= error;
        fatalController.abort(error);
        return;
      }

      const message = describeError(error);
      failures.push({ username: account.username, error: message });
      await markAccountFailed(account.id, message);
    }
  });

  // Todo lo que quedo 'running' al terminar es una cuenta que nunca se proceso
  // (aborto, o el proceso murio). Vuelve a la cola en vez de quedar trabada.
  const skipped = await releaseUnprocessedClaims(researchId);

  await closeScrapeRun(runId, {
    succeeded,
    failed: failures.length,
    fatalError,
  });

  if (fatalError) {
    await markResearchFailed(researchId, describeError(fatalError));
    throw fatalError;
  }

  // Solo si TODO fallo. Un fallo parcial deja la investigacion viva: las cuentas
  // que si se scrapearon sirven, y el resto se reintenta en la proxima corrida.
  if (succeeded === 0 && failures.length > 0) {
    await markResearchFailed(
      researchId,
      `Fallaron las ${failures.length} cuentas del scraping de perfiles`
    );
  }

  return {
    researchId,
    runId,
    claimed: claimed.length,
    succeeded,
    failed: failures.length,
    skipped,
    failures,
  };
}

// ─────────────────────────────────────────────────────────────
// Acceso a datos
// ─────────────────────────────────────────────────────────────

/**
 * Toma las cuentas pendientes de la investigacion marcandolas en el mismo
 * UPDATE que las selecciona. Dos procesos concurrentes no pueden llevarse la
 * misma fila: el segundo ve `scrape_status = 'running'` y la saltea.
 */
async function claimPendingAccounts(
  researchId: number,
  force: boolean
): Promise<ClaimedAccount[]> {
  const { rows } = await pool.query<ClaimedAccount>(
    `
    UPDATE accounts a
       SET scrape_status     = 'running',
           scrape_started_at = NOW(),
           scrape_error      = NULL
     WHERE a.id IN (
             SELECT ra.account_id
               FROM research_accounts ra
              WHERE ra.research_id = $1
           )
       AND ($2::boolean OR a.scraped = FALSE)
       AND (
             a.scrape_status <> 'running'
             OR a.scrape_started_at < NOW() - make_interval(mins => $3::int)
           )
    RETURNING a.id, a.username
    `,
    [researchId, force, CLAIM_TIMEOUT_MINUTES]
  );

  return rows;
}

/** Devuelve a la cola las cuentas reclamadas que nunca llegaron a procesarse. */
async function releaseUnprocessedClaims(researchId: number): Promise<number> {
  const { rowCount } = await pool.query(
    `
    UPDATE accounts a
       SET scrape_status = 'pending',
           scrape_started_at = NULL
     WHERE a.id IN (
             SELECT ra.account_id
               FROM research_accounts ra
              WHERE ra.research_id = $1
           )
       AND a.scrape_status = 'running'
    `,
    [researchId]
  );

  return rowCount ?? 0;
}

/**
 * Dos filas de `accounts` apuntan a la misma cuenta real de Instagram.
 *
 * Pasa cuando alguien se renombra: se agrega su @ nuevo a una investigacion, y
 * al scrapearlo vuelve el mismo `instagram_id` que ya tiene la fila del @ viejo
 * (la columna es UNIQUE). Postgres lo reporta como "duplicate key", que no dice
 * nada sobre lo que realmente pasa.
 */
export class DuplicateInstagramIdError extends Error {
  constructor(readonly username: string, readonly instagramId: string) {
    super(
      `@${username} tiene el mismo ID de Instagram (${instagramId}) que otra cuenta ya ` +
        `guardada: probablemente se renombro. Borra la cuenta vieja o quita esta de la investigacion.`
    );
    this.name = "DuplicateInstagramIdError";
  }
}

/** Codigo de Postgres para violacion de constraint UNIQUE. */
const PG_UNIQUE_VIOLATION = "23505";

/** Guarda el perfil y su snapshot diario en una sola transaccion. */
async function persistProfile(
  accountId: number,
  profile: AccountProfile
): Promise<void> {
  try {
    await persistProfileUnsafe(accountId, profile);
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (
      pgError?.code === PG_UNIQUE_VIOLATION &&
      pgError.constraint === "accounts_instagram_id_key"
    ) {
      throw new DuplicateInstagramIdError(
        profile.username,
        profile.instagram_id ?? "desconocido"
      );
    }
    throw error;
  }
}

async function persistProfileUnsafe(
  accountId: number,
  profile: AccountProfile
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE accounts SET
          instagram_id        = $2,
          full_name           = $3,
          biography           = $4,
          external_url        = $5,
          followers_count     = $6,
          follows_count       = $7,
          posts_count         = $8,
          is_business_account = $9,
          business_category   = $10,
          is_verified         = $11,
          is_private          = $12,
          profile_pic_url     = $13,
          scraped             = TRUE,
          scrape_status       = 'done',
          scrape_error        = NULL,
          scraped_at          = NOW(),
          updated_at          = NOW()
        WHERE id = $1
        `,
        [
          accountId,
          profile.instagram_id,
          profile.full_name,
          profile.biography,
          profile.external_url,
          profile.followers_count,
          profile.follows_count,
          profile.posts_count,
          profile.is_business_account,
          profile.business_category,
          profile.is_verified,
          profile.is_private,
          profile.profile_pic_url,
        ]
      );

    // Serie historica de seguidores. Una corrida repetida el mismo dia
    // pisa el snapshot con el dato mas fresco en vez de fallar por el UNIQUE.
    await client.query(
      `
        INSERT INTO account_snapshots
          (account_id, followers_count, follows_count, posts_count, snapshot_date)
        VALUES ($1, $2, $3, $4, CURRENT_DATE)
        ON CONFLICT (account_id, snapshot_date) DO UPDATE SET
          followers_count = EXCLUDED.followers_count,
          follows_count   = EXCLUDED.follows_count,
          posts_count     = EXCLUDED.posts_count
        `,
      [
        accountId,
        profile.followers_count,
        profile.follows_count,
        profile.posts_count,
      ]
    );
  });
}

async function markAccountFailed(accountId: number, message: string): Promise<void> {
  await pool.query(
    `
    UPDATE accounts
       SET scrape_status = 'failed',
           scrape_error  = $2,
           scraped       = FALSE,
           updated_at    = NOW()
     WHERE id = $1
    `,
    [accountId, message.slice(0, 500)]
  );
}

async function openScrapeRun(usernames: string[]): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `
    INSERT INTO scrape_runs (run_type, accounts_targeted, status)
    VALUES ('profiles', $1::jsonb, 'running')
    RETURNING id
    `,
    [JSON.stringify(usernames)]
  );

  return rows[0].id;
}

async function closeScrapeRun(
  runId: number,
  outcome: { succeeded: number; failed: number; fatalError?: Error }
): Promise<void> {
  const status =
    outcome.fatalError || (outcome.succeeded === 0 && outcome.failed > 0)
      ? "failed"
      : "completed";

  const errorMessage = outcome.fatalError
    ? describeError(outcome.fatalError)
    : outcome.failed > 0
      ? `${outcome.failed} cuenta(s) fallaron`
      : null;

  await pool.query(
    `
    UPDATE scrape_runs
       SET status           = $2,
           profiles_scraped = $3,
           completed_at     = NOW(),
           error_message    = $4
     WHERE id = $1
    `,
    [runId, status, outcome.succeeded, errorMessage]
  );
}

async function markResearchFailed(researchId: number, _reason: string): Promise<void> {
  // `researches` no tiene columna de error; el detalle queda en scrape_runs.
  await pool.query(`UPDATE researches SET status = 'failed' WHERE id = $1`, [
    researchId,
  ]);
}

async function resolveApifyToken(researchId: number): Promise<string | undefined> {
  const { rows } = await pool.query<{ apify_api_key: string | null }>(
    `
    SELECT up.apify_api_key
      FROM researches r
      JOIN user_profiles up ON up.user_id = r.user_id
     WHERE r.id = $1
    `,
    [researchId]
  );

  return rows[0]?.apify_api_key || process.env.APIFY_TOKEN || undefined;
}

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function describeError(error: unknown): string {
  if (error instanceof ProfileNotFoundError) {
    return `Cuenta inexistente o inaccesible: @${error.username}`;
  }
  return describeErrorBase(error);
}
