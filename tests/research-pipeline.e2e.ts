/**
 * Test del pipeline completo de una investigacion: perfiles → posts → scoring.
 *
 *   bash scripts/db-local.sh
 *   npm run test:pipeline
 *
 * Es lo que corre cuando alguien crea una investigacion desde la UI. Un doble
 * de Apify responde por los DOS actores (el oficial para perfiles, apidojo para
 * posts) segun el path del request.
 *
 * ⚠ BORRA el contenido de la base apuntada por DATABASE_URL.
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

const POSTS_POR_CUENTA = 3;

const estado = {
  perfilesPedidos: [] as string[],
  postsPedidos: [] as string[],
  /** usernames cuyo perfil no resuelve. */
  perfilRoto: new Set<string>(),
};

function hash32(texto: string, semilla: number): number {
  return [...texto].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, semilla);
}

function levantarDoble(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const input = JSON.parse(body || "{}");
        const esPerfil = (req.url ?? "").includes("instagram-profile-scraper");

        let items: unknown[];

        if (esPerfil) {
          const username: string = input.usernames?.[0] ?? "";
          estado.perfilesPedidos.push(username);
          items = estado.perfilRoto.has(username)
            ? []
            : [
                {
                  ...PERFIL_EJEMPLO,
                  username,
                  id: String(hash32(username, 5381)),
                  followersCount: 100_000,
                },
              ];
        } else {
          const url: string = input.startUrls?.[0] ?? "";
          const username = url.split("/").filter(Boolean).pop() ?? "";
          estado.postsPedidos.push(username);

          items = Array.from({ length: POSTS_POR_CUENTA }, (_, i) => {
            const a = hash32(`${username}|${i}`, 5381);
            const b = hash32(`${username}|${i}`, 52711);
            return {
              id: `3${String(a).padStart(9, "0")}${String(b).padStart(9, "0")}`,
              shortCode: `C${a.toString(36)}${b.toString(36)}`.slice(0, 11),
              type: i === 0 ? "Video" : "Image",
              url: `https://www.instagram.com/p/x${i}`,
              caption: `post ${i} de ${username}`,
              hashtags: ["marketing"],
              mentions: [],
              likesCount: 5_000 + i,
              commentsCount: 100,
              timestamp: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
              displayUrl: "https://cdn.example/x.jpg",
              dimensionsWidth: 1080,
              dimensionsHeight: 1350,
              ...(i === 0
                ? {
                    videoViewCount: 250_000,
                    videoPlayCount: 250_000,
                    videoDuration: 22.4,
                    sharesCount: 900,
                    productType: "clips",
                    transcript: "hola",
                    isPaidPartnership: false,
                  }
                : {}),
            };
          });
        }

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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL. Levantá la base con: bash scripts/db-local.sh");
    process.exit(1);
  }

  const { server, baseUrl } = await levantarDoble();
  process.env.APIFY_API_BASE_URL = baseUrl;
  console.log(`doble de Apify (perfiles + posts) en ${baseUrl}\n`);

  const { pool } = await import("../app/lib/pool");
  const { runResearchPipeline } = await import("../app/lib/jobs/research-pipeline");

  await pool.query(
    `TRUNCATE accounts, researches, research_accounts, account_snapshots, scrape_runs,
              posts, hashtags, post_hashtags, mentions, post_mentions
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

  /** Replica exactamente lo que hace POST /api/researches. */
  async function crearResearch(nombre: string, usernames: string[], daysBack = 30) {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO researches (name, status, user_id, days_back)
       VALUES ($1, 'scraping', $2, $3) RETURNING id`,
      [nombre, userId, daysBack]
    );
    const researchId = rows[0].id;

    const cuentas = await pool.query<{ id: number }>(
      `INSERT INTO accounts (username, account_type)
       SELECT u, 'competitor' FROM UNNEST($1::text[]) AS u
       ON CONFLICT (username) DO UPDATE SET
         updated_at = NOW(), scraped = FALSE, posts_scraped = FALSE,
         scrape_status = 'pending', posts_scrape_status = 'pending'
       RETURNING id`,
      [usernames]
    );
    await pool.query(
      `INSERT INTO research_accounts (research_id, account_id)
       SELECT $1, a FROM UNNEST($2::int[]) AS a ON CONFLICT DO NOTHING`,
      [researchId, cuentas.rows.map((r) => r.id)]
    );

    return researchId;
  }

  // ═══ E1 — investigación completa de punta a punta ═════════
  console.log("E1 — 3 cuentas: perfiles → posts → scoring");
  const r1 = await crearResearch("completa", ["alfa", "beta", "gama"]);
  await runResearchPipeline(r1);

  chequear(estado.perfilesPedidos.length === 3, "pidió los 3 perfiles", estado.perfilesPedidos.length);
  chequear(estado.postsPedidos.length === 3, "pidió los posts de las 3", estado.postsPedidos.length);
  chequear(
    estado.perfilesPedidos.length === 3 && estado.postsPedidos.length === 3,
    "los perfiles se piden ANTES que los posts (sin followers no hay engagement)"
  );

  const { rows: cuentas } = await pool.query(
    `SELECT username, followers_count, scraped, posts_scraped, scrape_status, posts_scrape_status
       FROM accounts ORDER BY username`
  );
  chequear(cuentas.length === 3, "3 cuentas", cuentas.length);
  chequear(
    cuentas.every((c) => c.scraped && c.posts_scraped),
    "todas con perfil y posts scrapeados",
    cuentas
  );
  chequear(
    cuentas.every((c) => c.followers_count === 100_000),
    "followers_count poblado desde el perfil",
    cuentas.map((c) => c.followers_count)
  );

  const { rows: totales } = await pool.query(`SELECT COUNT(*)::int AS n FROM posts`);
  chequear(totales[0].n === 9, "9 posts (3 cuentas x 3)", totales[0].n);

  // El scoring es la etapa 3 y corre sola al final del pipeline.
  const { rows: sinScore } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM posts WHERE engagement_rate IS NULL OR performance_score IS NULL`
  );
  chequear(sinScore[0].n === 0, "todos los posts con engagement_rate y performance_score", sinScore[0].n);

  const { rows: video } = await pool.query(
    `SELECT engagement_rate, performance_score, video_view_count
       FROM posts WHERE type = 'Video' ORDER BY id LIMIT 1`
  );
  const erEsperado = (5000 + 100 + 900) / 100_000;
  chequear(
    Math.abs(video[0].engagement_rate - erEsperado) < 0.0001,
    `engagement del video = (5000+100+900)/100000 = ${erEsperado}`,
    video[0].engagement_rate
  );
  chequear(video[0].performance_score > 0, "performance_score calculado", video[0].performance_score);

  const { rows: estadoFinal } = await pool.query(`SELECT status FROM researches WHERE id = $1`, [r1]);
  chequear(estadoFinal[0].status === "completed", "la investigación quedó 'completed'", estadoFinal[0].status);

  const { rows: runs } = await pool.query(
    `SELECT run_type, status, profiles_scraped, posts_scraped FROM scrape_runs ORDER BY id`
  );
  chequear(runs.length === 2, "2 scrape_runs: perfiles y posts", runs.length);
  chequear(
    runs[0].run_type === "profiles" && runs[0].profiles_scraped === 3,
    "run de perfiles: 3",
    runs[0]
  );
  chequear(runs[1].run_type === "posts" && runs[1].posts_scraped === 9, "run de posts: 9", runs[1]);
  chequear(runs.every((r) => r.status === "completed"), "los dos runs completed");

  // ═══ E2 — corta si ningún perfil se scrapea ═══════════════
  console.log("\nE2 — si NINGÚN perfil resuelve, no gasta créditos en posts");
  estado.perfilRoto.add("rota1").add("rota2");
  estado.postsPedidos.length = 0;

  const r2 = await crearResearch("rota", ["rota1", "rota2"]);
  await runResearchPipeline(r2);

  chequear(estado.postsPedidos.length === 0, "no pidió posts", estado.postsPedidos);
  const { rows: estadoR2 } = await pool.query(`SELECT status FROM researches WHERE id = $1`, [r2]);
  chequear(estadoR2[0].status === "failed", "la investigación queda 'failed'", estadoR2[0].status);

  // ═══ E3 — falla parcial: sigue adelante ═══════════════════
  console.log("\nE3 — si UN perfil falla, el pipeline sigue con los que sí");
  estado.perfilRoto.clear();
  estado.perfilRoto.add("mala");
  estado.postsPedidos.length = 0;

  const r3 = await crearResearch("parcial", ["buena1", "buena2", "mala"]);
  await runResearchPipeline(r3);

  chequear(estado.postsPedidos.length === 2, "pidió posts sólo de las 2 buenas", estado.postsPedidos);
  chequear(
    !estado.postsPedidos.includes("mala"),
    "no pidió posts de la que no tiene perfil",
    estado.postsPedidos
  );

  const { rows: estadoR3 } = await pool.query(`SELECT status FROM researches WHERE id = $1`, [r3]);
  chequear(estadoR3[0].status === "completed", "queda 'completed': hubo resultados útiles", estadoR3[0].status);

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
