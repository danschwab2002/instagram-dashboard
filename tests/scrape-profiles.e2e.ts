/**
 * Test de regresion del scraping de perfiles, contra un Postgres real.
 *
 *   bash scripts/db-local.sh                       # una vez, levanta la base
 *   npm run test:scrape-profiles
 *
 * Apify se reemplaza por un servidor HTTP local (via APIFY_API_BASE_URL), asi
 * que no gasta creditos ni le pega a Instagram. Cada escenario cubre un defecto
 * concreto del workflow WF2 de n8n que este codigo vino a corregir.
 *
 * ⚠ BORRA el contenido de la base apuntada por DATABASE_URL. Correr solo contra
 * la base local de desarrollo.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PERFIL_EJEMPLO = JSON.parse(
  readFileSync(
    join(AQUI, "../../apify-documentation/instagram-scraper/scraped-instagram-profile-example.json"),
    "utf8"
  )
);

// ── Doble de Apify ──────────────────────────────────────────

interface EstadoDoble {
  /** usernames que el actor "no resuelve": devuelve dataset vacio. */
  inexistentes: Set<string>;
  /** si esta seteado, TODA request responde con ese status HTTP. */
  forzarStatus?: number;
  /** si esta seteado, todo perfil vuelve con ESE instagram id (simula renombre). */
  idFijo?: string;
  /** cuantas veces se pidio cada username. */
  llamadas: Map<string, number>;
}

const estado: EstadoDoble = { inexistentes: new Set(), llamadas: new Map() };

/** Id estable y distinto por username: `accounts.instagram_id` es UNIQUE. */
function idSintetico(username: string): string {
  const hash = [...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_000_000, 7);
  return String(7_000_000_000 + hash);
}

function levantarDobleApify(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (estado.forzarStatus) {
          res.writeHead(estado.forzarStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "forzado por el test" } }));
          return;
        }

        const username: string = JSON.parse(body || "{}").usernames?.[0] ?? "";
        estado.llamadas.set(username, (estado.llamadas.get(username) ?? 0) + 1);

        const items = estado.inexistentes.has(username)
          ? []
          : [{ ...PERFIL_EJEMPLO, username, id: estado.idFijo ?? idSintetico(username) }];

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(items));
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ── Aserciones ──────────────────────────────────────────────

let fallas = 0;

function chequear(ok: boolean, descripcion: string, detalle?: unknown): void {
  if (ok) {
    console.log(`  ok    ${descripcion}`);
  } else {
    fallas++;
    console.log(
      `  FALLA ${descripcion}${detalle !== undefined ? ` -> ${JSON.stringify(detalle)}` : ""}`
    );
  }
}

// ── Escenarios ──────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL. Levantá la base con: bash scripts/db-local.sh");
    process.exit(1);
  }

  const { server, baseUrl } = await levantarDobleApify();
  process.env.APIFY_API_BASE_URL = baseUrl;
  console.log(`doble de Apify en ${baseUrl}\n`);

  // Import dinamico: el cliente lee APIFY_API_BASE_URL al cargarse el modulo.
  const { pool } = await import("../app/lib/pool");
  const { scrapeProfilesForResearch } = await import("../app/lib/jobs/scrape-profiles");

  await pool.query(
    `TRUNCATE accounts, researches, research_accounts, account_snapshots, scrape_runs, posts
     RESTART IDENTITY CASCADE`
  );
  await pool.query(`DELETE FROM user_profiles`);
  await pool.query(`DELETE FROM auth.users`);

  const { rows: usuarios } = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (email) VALUES ('dev@local') RETURNING id`
  );
  const userId = usuarios[0].id;
  await pool.query(
    `INSERT INTO user_profiles (user_id, apify_api_key) VALUES ($1, 'token-de-prueba')`,
    [userId]
  );

  /** Replica el SQL del POST /api/researches. */
  async function crearResearch(nombre: string, usernames: string[]): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO researches (name, status, user_id, days_back)
       VALUES ($1, 'scraping', $2, 30) RETURNING id`,
      [nombre, userId]
    );
    const researchId = rows[0].id;

    const cuentas = await pool.query<{ id: number }>(
      `INSERT INTO accounts (username, account_type)
       SELECT u, 'competitor' FROM UNNEST($1::text[]) AS u
       ON CONFLICT (username) DO UPDATE SET
         scraped = FALSE, posts_scraped = FALSE, scrape_status = 'pending'
       RETURNING id`,
      [usernames]
    );

    await pool.query(
      `INSERT INTO research_accounts (research_id, account_id)
       SELECT $1, a FROM UNNEST($2::int[]) AS a ON CONFLICT DO NOTHING`,
      [researchId, cuentas.rows.map((row) => row.id)]
    );

    return researchId;
  }

  // ═══ E1 — corrida feliz ═══════════════════════════════════
  console.log("E1 — corrida feliz, 3 cuentas");
  const r1 = await crearResearch("feliz", ["teslamotors", "nike", "adidas"]);
  const res1 = await scrapeProfilesForResearch(r1);

  chequear(res1.claimed === 3, "reclamó las 3 cuentas", res1.claimed);
  chequear(res1.succeeded === 3, "scrapeó las 3", res1);
  chequear(res1.failed === 0 && res1.skipped === 0, "sin fallas ni salteadas", res1);

  const cuentas = await pool.query(
    `SELECT username, instagram_id, full_name, biography, external_url, followers_count,
            follows_count, posts_count, is_business_account, business_category,
            is_verified, is_private, profile_pic_url, scraped, scrape_status, scraped_at
       FROM accounts ORDER BY username`
  );
  chequear(cuentas.rowCount === 3, "3 filas en accounts", cuentas.rowCount);

  const nulos = [
    ...new Set(
      cuentas.rows.flatMap((row) =>
        Object.entries(row).filter(([, v]) => v === null).map(([k]) => k)
      )
    ),
  ];
  chequear(nulos.length === 0, "ningún campo quedó en null", nulos);
  chequear(
    cuentas.rows.every((r) => r.scraped === true && r.scrape_status === "done"),
    "todas quedaron scraped/done"
  );
  // Defecto #6 del WF2: nunca mapeaba profile_pic_url, external_url ni follows_count.
  chequear(
    cuentas.rows.every((r) => r.profile_pic_url && r.external_url && r.follows_count > 0),
    "profile_pic_url / external_url / follows_count poblados (el WF2 los dejaba vacíos)"
  );

  const snapshots = await pool.query(`SELECT COUNT(*)::int AS n FROM account_snapshots`);
  chequear(snapshots.rows[0].n === 3, "3 snapshots históricos", snapshots.rows[0].n);

  const { rows: runs } = await pool.query(`SELECT * FROM scrape_runs WHERE id = $1`, [res1.runId]);
  chequear(runs[0].status === "completed", "scrape_run cerrado como completed", runs[0].status);
  // Defecto #5 del WF2: escribia usernames concatenados en una columna INTEGER.
  chequear(runs[0].profiles_scraped === 3, "profiles_scraped = 3 (entero, no string)", runs[0].profiles_scraped);
  chequear(runs[0].completed_at !== null, "completed_at seteado");

  // ═══ E2 — idempotencia ════════════════════════════════════
  console.log("\nE2 — re-corrida sin --force");
  const antes = estado.llamadas.get("nike") ?? 0;
  const res2 = await scrapeProfilesForResearch(r1);
  chequear(res2.claimed === 0, "no reclama nada: ya estaban scrapeadas", res2.claimed);
  chequear(res2.runId === null, "no abre un scrape_run vacío", res2.runId);
  chequear((estado.llamadas.get("nike") ?? 0) === antes, "no gastó créditos de nuevo");

  console.log("\nE2b — re-corrida con force");
  const res2b = await scrapeProfilesForResearch(r1, { force: true });
  chequear(res2b.claimed === 3 && res2b.succeeded === 3, "force re-scrapea las 3", res2b);
  const snapshots2 = await pool.query(`SELECT COUNT(*)::int AS n FROM account_snapshots`);
  chequear(snapshots2.rows[0].n === 3, "el snapshot del día se pisa, no duplica", snapshots2.rows[0].n);

  // ═══ E3 — falla parcial ═══════════════════════════════════
  // Defecto #4 del WF2: sin rama de error, una cuenta rota dejaba el run
  // colgado en 'running' y la investigación en 'scraping' para siempre.
  console.log("\nE3 — una cuenta inexistente, el resto sigue");
  estado.inexistentes.add("cuentafantasma");
  const r3 = await crearResearch("parcial", ["gopro", "cuentafantasma", "redbull"]);
  const res3 = await scrapeProfilesForResearch(r3);

  chequear(res3.succeeded === 2, "2 exitosas: la falla NO cortó la corrida", res3.succeeded);
  chequear(res3.failed === 1, "1 fallada", res3.failed);
  chequear(res3.failures[0]?.username === "cuentafantasma", "identifica cuál falló", res3.failures);

  const { rows: fantasma } = await pool.query(
    `SELECT scrape_status, scrape_error FROM accounts WHERE username = 'cuentafantasma'`
  );
  chequear(fantasma[0].scrape_status === "failed", "la fallada queda en 'failed'", fantasma[0]);
  chequear(fantasma[0].scrape_error !== null, "guarda el motivo", fantasma[0].scrape_error);

  const { rows: estadoR3 } = await pool.query(`SELECT status FROM researches WHERE id = $1`, [r3]);
  chequear(
    estadoR3[0].status === "scraping",
    "falla parcial NO marca la investigación como failed",
    estadoR3[0].status
  );

  // ═══ E4 — error fatal ═════════════════════════════════════
  console.log("\nE4 — token rechazado (401): aborta sin quemar requests");
  const r4 = await crearResearch("fatal", ["a1", "a2", "a3", "a4", "a5", "a6"]);
  estado.llamadas.clear();
  estado.forzarStatus = 401;

  let tiro = false;
  try {
    await scrapeProfilesForResearch(r4);
  } catch (error) {
    tiro = true;
    chequear((error as Error).name === "ApifyAuthError", "propaga ApifyAuthError", (error as Error).name);
  }
  chequear(tiro, "la corrida tira en vez de seguir en silencio");

  const totalLlamadas = [...estado.llamadas.values()].reduce((a, b) => a + b, 0);
  chequear(totalLlamadas < 6, `cortó temprano: ${totalLlamadas} requests para 6 cuentas`, totalLlamadas);

  const { rows: estadoR4 } = await pool.query(`SELECT status FROM researches WHERE id = $1`, [r4]);
  chequear(estadoR4[0].status === "failed", "la investigación queda 'failed'", estadoR4[0].status);

  const { rows: trabadas } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM accounts a
       JOIN research_accounts ra ON ra.account_id = a.id
      WHERE ra.research_id = $1 AND a.scrape_status = 'running'`,
    [r4]
  );
  chequear(trabadas[0].n === 0, "ninguna cuenta quedó trabada en 'running'", trabadas[0].n);
  estado.forzarStatus = undefined;

  // ═══ E5 — concurrencia ════════════════════════════════════
  // Defecto #3 del WF2: dos corridas leian el mismo `scraped = FALSE` y
  // scrapeaban las mismas cuentas dos veces, pagando doble.
  console.log("\nE5 — dos corridas simultáneas sobre la misma investigación");
  const r5 = await crearResearch("concurrente", ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]);
  estado.llamadas.clear();

  const [corridaA, corridaB] = await Promise.all([
    scrapeProfilesForResearch(r5, { concurrency: 4 }),
    scrapeProfilesForResearch(r5, { concurrency: 4 }),
  ]);

  chequear(
    corridaA.claimed + corridaB.claimed === 8,
    `entre las dos reclamaron 8 sin solaparse (${corridaA.claimed} + ${corridaB.claimed})`,
    corridaA.claimed + corridaB.claimed
  );
  const repetidas = [...estado.llamadas.entries()].filter(([, n]) => n > 1);
  chequear(repetidas.length === 0, "ninguna cuenta se scrapeó dos veces", repetidas);

  const { rows: scrapeadas } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM accounts a
       JOIN research_accounts ra ON ra.account_id = a.id
      WHERE ra.research_id = $1 AND a.scraped = TRUE`,
    [r5]
  );
  chequear(scrapeadas[0].n === 8, "las 8 quedaron scrapeadas", scrapeadas[0].n);

  // ═══ E6 — claims huérfanos ════════════════════════════════
  console.log("\nE6 — claim huérfano (worker muerto hace 20 min)");
  const r6 = await crearResearch("huerfana", ["h1", "h2"]);
  await pool.query(
    `UPDATE accounts SET scrape_status = 'running', scrape_started_at = NOW() - INTERVAL '20 minutes'
      WHERE username IN ('h1','h2')`
  );
  const res6 = await scrapeProfilesForResearch(r6);
  chequear(res6.claimed === 2, "recupera el claim vencido", res6.claimed);
  chequear(res6.succeeded === 2, "y las scrapea", res6.succeeded);

  console.log("\nE6b — claim fresco de otro worker (hace 1 min): NO se toca");
  const r6b = await crearResearch("fresca", ["h3", "h4"]);
  await pool.query(
    `UPDATE accounts SET scrape_status = 'running', scrape_started_at = NOW() - INTERVAL '1 minute'
      WHERE username IN ('h3','h4')`
  );
  const res6b = await scrapeProfilesForResearch(r6b);
  chequear(res6b.claimed === 0, "respeta el trabajo en curso ajeno", res6b.claimed);

  // ═══ E7 — cuenta renombrada ═══════════════════════════════
  console.log("\nE7 — @nuevo devuelve el mismo instagram_id que un @viejo ya guardado");
  const r7 = await crearResearch("renombrada", ["cuenta_vieja"]);
  await scrapeProfilesForResearch(r7);
  const { rows: vieja } = await pool.query(
    `SELECT instagram_id FROM accounts WHERE username = 'cuenta_vieja'`
  );

  estado.idFijo = vieja[0].instagram_id;
  const r7b = await crearResearch("renombrada-2", ["cuenta_nueva"]);
  const res7 = await scrapeProfilesForResearch(r7b);
  estado.idFijo = undefined;

  chequear(res7.failed === 1, "choca contra el id repetido", res7.failures);
  chequear(
    res7.failures[0]?.error.includes("se renombro"),
    "el error explica el renombre, no 'duplicate key'",
    res7.failures[0]?.error
  );

  // ── Cierre ──
  server.close();
  await pool.end();

  console.log(`\n${"=".repeat(52)}`);
  console.log(fallas === 0 ? "TODO OK" : `${fallas} FALLAS`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nel arnés reventó:", error);
  process.exit(1);
});
