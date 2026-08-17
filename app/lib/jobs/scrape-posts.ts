import { pool, withTransaction } from "../pool";
import { ApifyAuthError, ApifyPaymentError } from "../apify/client";
import {
  scrapePosts,
  DEFAULT_MAX_POSTS,
  type PostRecord,
} from "../apify/post-scraper";
import { mapWithConcurrency, isAbort, describeError } from "./shared";

/**
 * Reemplazo en codigo del workflow "WF3 - IG Scrape Posts" de n8n.
 *
 * Query de entrada del WF3 original (traceblog 2026-03-23):
 *   SELECT * FROM accounts WHERE scraped = TRUE AND posts_scraped = FALSE
 *
 * Ese filtro sigue siendo el corazon del job — LES-004: descartar cuentas ANTES
 * de llamar a Apify es lo que evita pagar dos veces por el mismo feed. Lo que
 * cambia es todo lo de alrededor, con las mismas correcciones que el job de
 * perfiles: alcance por investigacion, token del usuario, claim atomico, y una
 * cuenta que falla no arrastra al resto.
 *
 * Especifico de posts:
 *  - Respeta `researches.days_back` traduciendolo al parametro `until` del
 *    actor, asi el recorte pasa del lado de Apify y no se paga de mas.
 *  - Upsert por `short_code`, NO insert (LES-010): re-scrapear una cuenta
 *    actualiza los contadores de sus posts en vez de duplicarlos.
 *  - Al actualizar un post, blanquea engagement_rate y performance_score: las
 *    funciones de scoring solo recalculan donde estan en NULL, asi que sin esto
 *    un post re-scrapeado se quedaria con la metrica vieja para siempre.
 */

/** Un claim mas viejo que esto se considera huerfano: el worker murio. */
const CLAIM_TIMEOUT_MINUTES = 20;

/** Un feed es mucho mas pesado que un perfil; de a 2 el gasto es mas facil de seguir. */
const DEFAULT_CONCURRENCY = 2;

/** Los feeds tardan mas que los perfiles: se le da mas aire al run de Apify. */
const WAIT_FOR_FINISH_SECS = 240;

export interface ScrapePostsJobOptions {
  apifyToken?: string;
  concurrency?: number;
  signal?: AbortSignal;
  /** Vuelve a scrapear cuentas ya marcadas como `posts_scraped`. */
  force?: boolean;
  /** Techo de posts por cuenta. Default 200. */
  maxPosts?: number;
}

export interface ScrapePostsJobResult {
  researchId: number;
  runId: number | null;
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Total de posts insertados o actualizados en la corrida. */
  postsUpserted: number;
  /** Items que Apify devolvio con una forma que no se puede guardar. */
  descartados: number;
  failures: Array<{ username: string; error: string }>;
}

interface ClaimedAccount {
  id: number;
  username: string;
}

export async function scrapePostsForResearch(
  researchId: number,
  options: ScrapePostsJobOptions = {}
): Promise<ScrapePostsJobResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const contexto = await cargarContexto(researchId);

  const token = options.apifyToken ?? contexto.apifyToken;
  if (!token) {
    throw new Error(
      `La investigacion ${researchId} no tiene token de Apify: cargalo en /settings ` +
        `o defini APIFY_TOKEN en el entorno.`
    );
  }

  const claimed = await claimPendingAccounts(researchId, options.force ?? false);
  if (claimed.length === 0) {
    return vacio(researchId);
  }

  const runId = await openScrapeRun(claimed.map((a) => a.username));

  const fatalController = new AbortController();
  let fatalError: Error | undefined;

  const signal = options.signal
    ? AbortSignal.any([options.signal, fatalController.signal])
    : fatalController.signal;

  const failures: ScrapePostsJobResult["failures"] = [];
  let succeeded = 0;
  let postsUpserted = 0;
  let descartados = 0;

  await mapWithConcurrency(claimed, concurrency, async (account) => {
    if (signal.aborted) return;

    try {
      const resultado = await scrapePosts(account.username, {
        token,
        signal,
        desde: contexto.desde,
        maxItems: options.maxPosts ?? DEFAULT_MAX_POSTS,
        waitForFinishSecs: WAIT_FOR_FINISH_SECS,
      });

      descartados += resultado.descartados.length;
      for (const descarte of resultado.descartados) {
        console.warn(
          `[research ${researchId}] @${account.username} descarto ${descarte.shortCode}: ${descarte.motivo}`
        );
      }

      const guardados = await persistPosts(
        account.id,
        resultado.posts,
        contexto.userId
      );
      postsUpserted += guardados;

      await markAccountDone(account.id);
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

  const skipped = await releaseUnprocessedClaims(researchId);

  await closeScrapeRun(runId, { postsUpserted, failed: failures.length, fatalError });

  if (fatalError) {
    await markResearchFailed(researchId);
    throw fatalError;
  }

  if (succeeded === 0 && failures.length > 0) {
    await markResearchFailed(researchId);
  }

  return {
    researchId,
    runId,
    claimed: claimed.length,
    succeeded,
    failed: failures.length,
    skipped,
    postsUpserted,
    descartados,
    failures,
  };
}

// ─────────────────────────────────────────────────────────────
// Acceso a datos
// ─────────────────────────────────────────────────────────────

interface ContextoResearch {
  userId: string | null;
  apifyToken: string | undefined;
  /** Fecha limite (YYYY-MM-DD) derivada de days_back. */
  desde: string | undefined;
}

async function cargarContexto(researchId: number): Promise<ContextoResearch> {
  const { rows } = await pool.query<{
    user_id: string | null;
    apify_api_key: string | null;
    desde: string | null;
  }>(
    `
    SELECT r.user_id,
           up.apify_api_key,
           TO_CHAR(CURRENT_DATE - COALESCE(r.days_back, 30), 'YYYY-MM-DD') AS desde
      FROM researches r
      LEFT JOIN user_profiles up ON up.user_id = r.user_id
     WHERE r.id = $1
    `,
    [researchId]
  );

  if (rows.length === 0) {
    throw new Error(`No existe la investigacion ${researchId}`);
  }

  return {
    userId: rows[0].user_id,
    apifyToken: rows[0].apify_api_key || process.env.APIFY_TOKEN || undefined,
    desde: rows[0].desde ?? undefined,
  };
}

/**
 * Toma las cuentas con perfil listo y posts pendientes, marcandolas en el mismo
 * UPDATE que las selecciona. El filtro `scraped = TRUE` es el del WF3 original:
 * sin perfil no hay followers_count, y sin followers_count el engagement_rate
 * de sus posts daria cero.
 */
async function claimPendingAccounts(
  researchId: number,
  force: boolean
): Promise<ClaimedAccount[]> {
  const { rows } = await pool.query<ClaimedAccount>(
    `
    UPDATE accounts a
       SET posts_scrape_status     = 'running',
           posts_scrape_started_at = NOW(),
           posts_scrape_error      = NULL
     WHERE a.id IN (
             SELECT ra.account_id
               FROM research_accounts ra
              WHERE ra.research_id = $1
           )
       AND a.scraped = TRUE
       AND ($2::boolean OR a.posts_scraped = FALSE)
       AND (
             a.posts_scrape_status <> 'running'
             OR a.posts_scrape_started_at < NOW() - make_interval(mins => $3::int)
           )
    RETURNING a.id, a.username
    `,
    [researchId, force, CLAIM_TIMEOUT_MINUTES]
  );

  return rows;
}

async function releaseUnprocessedClaims(researchId: number): Promise<number> {
  const { rowCount } = await pool.query(
    `
    UPDATE accounts a
       SET posts_scrape_status     = 'pending',
           posts_scrape_started_at = NULL
     WHERE a.id IN (
             SELECT ra.account_id
               FROM research_accounts ra
              WHERE ra.research_id = $1
           )
       AND a.posts_scrape_status = 'running'
    `,
    [researchId]
  );

  return rowCount ?? 0;
}

/**
 * Guarda todos los posts de una cuenta en una transaccion, con sus hashtags y
 * menciones. O entra el feed entero o no entra nada: media cuenta guardada es
 * peor que ninguna, porque `posts_scraped` la daria por completa.
 */
async function persistPosts(
  accountId: number,
  posts: PostRecord[],
  userId: string | null
): Promise<number> {
  if (posts.length === 0) return 0;

  try {
    return await persistPostsUnsafe(accountId, posts, userId);
  } catch (error) {
    // `posts` tiene UNIQUE en short_code Y en instagram_id. El upsert resuelve
    // el primero, pero si dos filas discrepan en el segundo Postgres tira un
    // "duplicate key" que no dice nada — y como el feed entero va en una sola
    // transaccion, se cae la cuenta completa por un post.
    const pgError = error as { code?: string; constraint?: string };
    if (
      pgError?.code === PG_UNIQUE_VIOLATION &&
      pgError.constraint === "posts_instagram_id_key"
    ) {
      throw new Error(
        `Un post trae un instagram_id que ya pertenece a otro short_code. ` +
          `Suele ser un post republicado o un shortCode reciclado; revisá los ` +
          `posts de esta cuenta a mano.`
      );
    }
    throw error;
  }
}

/** Codigo de Postgres para violacion de constraint UNIQUE. */
const PG_UNIQUE_VIOLATION = "23505";

async function persistPostsUnsafe(
  accountId: number,
  posts: PostRecord[],
  userId: string | null
): Promise<number> {
  return withTransaction(async (client) => {
    // Un solo INSERT para el feed entero. jsonb_to_recordset expande el array
    // en filas tipadas; con 21 columnas es mas legible que 21 arrays paralelos.
    const { rows } = await client.query<{ id: number; short_code: string }>(
      `
      INSERT INTO posts (
        account_id, scraped_by, instagram_id, short_code, url, type, caption,
        likes_count, comments_count, shares_count,
        video_view_count, video_play_count, video_duration,
        display_url, dimensions_width, dimensions_height,
        location_name, location_id, is_paid_partnership, product_type,
        transcript, posted_at, scraped_at
      )
      SELECT
        $1, $2::uuid, x.instagram_id, x.short_code, x.url, x.type, x.caption,
        x.likes_count, x.comments_count, x.shares_count,
        x.video_view_count, x.video_play_count, x.video_duration,
        x.display_url, x.dimensions_width, x.dimensions_height,
        x.location_name, x.location_id, x.is_paid_partnership, x.product_type,
        x.transcript, x.posted_at, NOW()
      FROM jsonb_to_recordset($3::jsonb) AS x(
        instagram_id        text,
        short_code          text,
        url                 text,
        type                text,
        caption             text,
        likes_count         integer,
        comments_count      integer,
        shares_count        integer,
        video_view_count    integer,
        video_play_count    integer,
        video_duration      real,
        display_url         text,
        dimensions_width    integer,
        dimensions_height   integer,
        location_name       text,
        location_id         text,
        is_paid_partnership boolean,
        product_type        text,
        transcript          text,
        posted_at           timestamptz
      )
      ON CONFLICT (short_code) DO UPDATE SET
        likes_count         = EXCLUDED.likes_count,
        comments_count      = EXCLUDED.comments_count,
        shares_count        = EXCLUDED.shares_count,
        video_view_count    = EXCLUDED.video_view_count,
        video_play_count    = EXCLUDED.video_play_count,
        video_duration      = EXCLUDED.video_duration,
        caption             = EXCLUDED.caption,
        display_url         = EXCLUDED.display_url,
        transcript          = COALESCE(EXCLUDED.transcript, posts.transcript),
        product_type        = EXCLUDED.product_type,
        is_paid_partnership = EXCLUDED.is_paid_partnership,
        scraped_at          = NOW(),
        -- Los contadores cambiaron: las metricas viejas ya no valen. Las
        -- funciones de scoring solo recalculan lo que esta en NULL.
        engagement_rate     = NULL,
        performance_score   = NULL
      RETURNING id, short_code
      `,
      [accountId, userId, JSON.stringify(posts)]
    );

    // Solo los posts que tienen algo que relacionar. En un feed normal la
    // mayoria no tiene menciones, asi que esto recorta bastante los viajes.
    const porShortCode = new Map(rows.map((r) => [r.short_code, r.id]));

    for (const post of posts) {
      const postId = porShortCode.get(post.short_code);
      if (!postId) continue;

      if (post.hashtags.length > 0) {
        await client.query(`SELECT upsert_post_hashtags($1, $2::text[])`, [
          postId,
          post.hashtags,
        ]);
      }
      if (post.mentions.length > 0) {
        await client.query(`SELECT upsert_post_mentions($1, $2::text[])`, [
          postId,
          post.mentions,
        ]);
      }
    }

    return rows.length;
  });
}

async function markAccountDone(accountId: number): Promise<void> {
  await pool.query(
    `
    UPDATE accounts
       SET posts_scraped              = TRUE,
           posts_scrape_status        = 'done',
           posts_scrape_error         = NULL,
           last_updated_posts_scraped = CURRENT_DATE,
           updated_at                 = NOW()
     WHERE id = $1
    `,
    [accountId]
  );
}

async function markAccountFailed(accountId: number, message: string): Promise<void> {
  await pool.query(
    `
    UPDATE accounts
       SET posts_scrape_status = 'failed',
           posts_scrape_error  = $2,
           posts_scraped       = FALSE,
           updated_at          = NOW()
     WHERE id = $1
    `,
    [accountId, message.slice(0, 500)]
  );
}

async function openScrapeRun(usernames: string[]): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `
    INSERT INTO scrape_runs (run_type, accounts_targeted, status)
    VALUES ('posts', $1::jsonb, 'running')
    RETURNING id
    `,
    [JSON.stringify(usernames)]
  );

  return rows[0].id;
}

async function closeScrapeRun(
  runId: number,
  outcome: { postsUpserted: number; failed: number; fatalError?: Error }
): Promise<void> {
  const status =
    outcome.fatalError || (outcome.postsUpserted === 0 && outcome.failed > 0)
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
       SET status        = $2,
           posts_scraped = $3,
           completed_at  = NOW(),
           error_message = $4
     WHERE id = $1
    `,
    [runId, status, outcome.postsUpserted, errorMessage]
  );
}

async function markResearchFailed(researchId: number): Promise<void> {
  await pool.query(`UPDATE researches SET status = 'failed' WHERE id = $1`, [
    researchId,
  ]);
}

function vacio(researchId: number): ScrapePostsJobResult {
  return {
    researchId,
    runId: null,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    postsUpserted: 0,
    descartados: 0,
    failures: [],
  };
}
