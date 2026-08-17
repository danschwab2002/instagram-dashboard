/**
 * Test de regresion del scraping de posts (ex WF3), contra un Postgres real.
 *
 *   bash scripts/db-local.sh
 *   npm run test:scrape-posts
 *
 * Apify se reemplaza por un servidor HTTP local: no gasta creditos ni le pega a
 * Instagram. El doble sirve posts del actor apidojo, que es el que usa el job.
 *
 * ⚠ BORRA el contenido de la base apuntada por DATABASE_URL.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ── Doble de Apify ──────────────────────────────────────────

interface PostFalso {
  type: "Image" | "Video" | "Sidecar";
  diasAtras: number;
  likesCount?: number;
  videoViewCount?: number;
  sharesCount?: number;
  hashtags?: string[];
  mentions?: string[];
}

interface EstadoDoble {
  /** Que posts devuelve cada cuenta. */
  feeds: Map<string, PostFalso[]>;
  /** Items crudos extra, para probar formas invalidas. */
  basura: Map<string, unknown[]>;
  forzarStatus?: number;
  /** Ultimo input recibido por cuenta: sirve para verificar `until`. */
  inputs: Map<string, Record<string, unknown>>;
  llamadas: Map<string, number>;
}

const estado: EstadoDoble = {
  feeds: new Map(),
  basura: new Map(),
  inputs: new Map(),
  llamadas: new Map(),
};

/**
 * Ids y shortCodes estables y unicos: `short_code` e `instagram_id` son las dos
 * UNIQUE en `posts`. Deterministas a proposito — el escenario de --force
 * re-scrapea el mismo feed y espera que los short_code coincidan para que el
 * upsert actualice en vez de duplicar.
 *
 * Dos hashes con semillas distintas: una version anterior truncaba un solo hash
 * y hacia colisionar cuentas con prefijo comun (marca_b/marca_c).
 */
function hash32(texto: string, semilla: number): number {
  return [...texto].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, semilla);
}

function identidad(username: string, indice: number) {
  const clave = `${username}|${indice}`;
  const a = hash32(clave, 5381);
  const b = hash32(clave, 52711);

  return {
    id: `3${String(a).padStart(9, "0")}${String(b).padStart(9, "0")}`,
    shortCode: `C${a.toString(36)}${b.toString(36)}`.slice(0, 11),
  };
}

function construirPost(username: string, indice: number, spec: PostFalso) {
  const { id, shortCode } = identidad(username, indice);
  const timestamp = new Date(
    Date.now() - spec.diasAtras * 24 * 60 * 60 * 1000
  ).toISOString();

  const base: Record<string, unknown> = {
    queryUsername: username,
    ownerUsername: username,
    position: indice,
    id,
    shortCode,
    type: spec.type,
    url: `https://www.instagram.com/p/${shortCode}`,
    caption: `post ${indice} de ${username}`,
    hashtags: spec.hashtags ?? [],
    mentions: spec.mentions ?? [],
    likesCount: spec.likesCount ?? 1000 + indice,
    commentsCount: 50 + indice,
    timestamp,
    displayUrl: `https://cdn.example/${shortCode}.jpg`,
    dimensionsWidth: 1080,
    dimensionsHeight: 1350,
    locationName: null,
    locationId: null,
  };

  if (spec.type === "Video") {
    Object.assign(base, {
      videoViewCount: spec.videoViewCount ?? 50_000 + indice * 100,
      videoPlayCount: spec.videoViewCount ?? 50_000 + indice * 100,
      videoDuration: 15.5,
      sharesCount: spec.sharesCount ?? 200,
      productType: "clips",
      transcript: `transcripcion del post ${indice}`,
      isPaidPartnership: false,
    });
  }

  return base;
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

        const input = JSON.parse(body || "{}");
        const url: string = input.startUrls?.[0] ?? "";
        const username = url.split("/").filter(Boolean).pop() ?? "";

        estado.inputs.set(username, input);
        estado.llamadas.set(username, (estado.llamadas.get(username) ?? 0) + 1);

        const specs = estado.feeds.get(username) ?? [];
        const items: unknown[] = specs.map((spec, i) => construirPost(username, i, spec));
        items.push(...(estado.basura.get(username) ?? []));

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

  const { pool } = await import("../app/lib/pool");
  const { scrapePostsForResearch } = await import("../app/lib/jobs/scrape-posts");

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

  /** Crea la investigacion con las cuentas YA scrapeadas de perfil. */
  async function crearResearch(
    nombre: string,
    cuentas: Array<{ username: string; followers?: number; perfilListo?: boolean }>,
    daysBack = 30
  ): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO researches (name, status, user_id, days_back)
       VALUES ($1, 'scraping', $2, $3) RETURNING id`,
      [nombre, userId, daysBack]
    );
    const researchId = rows[0].id;

    for (const cuenta of cuentas) {
      const perfilListo = cuenta.perfilListo ?? true;
      const { rows: acc } = await pool.query<{ id: number }>(
        `INSERT INTO accounts (username, account_type, followers_count, scraped, scrape_status,
                               posts_scraped, posts_scrape_status)
         VALUES ($1, 'competitor', $2, $3, $4, FALSE, 'pending')
         ON CONFLICT (username) DO UPDATE SET
           followers_count = EXCLUDED.followers_count,
           scraped = EXCLUDED.scraped,
           posts_scraped = FALSE,
           posts_scrape_status = 'pending'
         RETURNING id`,
        [cuenta.username, cuenta.followers ?? 100_000, perfilListo, perfilListo ? "done" : "pending"]
      );
      await pool.query(
        `INSERT INTO research_accounts (research_id, account_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [researchId, acc[0].id]
      );
    }

    return researchId;
  }

  // ═══ E1 — corrida feliz ═══════════════════════════════════
  console.log("E1 — 2 cuentas, posts de imagen y video");
  estado.feeds.set("marca_a", [
    { type: "Video", diasAtras: 2, hashtags: ["Fitness", "fitness", " GYM "], mentions: ["Coach"] },
    { type: "Image", diasAtras: 5, hashtags: ["fitness"] },
    { type: "Video", diasAtras: 9, videoViewCount: 900_000 },
  ]);
  estado.feeds.set("marca_b", [{ type: "Image", diasAtras: 1 }]);

  const r1 = await crearResearch("feliz", [
    { username: "marca_a", followers: 200_000 },
    { username: "marca_b", followers: 50_000 },
  ]);
  const res1 = await scrapePostsForResearch(r1);

  chequear(res1.claimed === 2, "reclamó las 2 cuentas", res1.claimed);
  chequear(res1.succeeded === 2, "las 2 exitosas", res1);
  chequear(res1.postsUpserted === 4, "4 posts guardados", res1.postsUpserted);

  const { rows: posts } = await pool.query(
    `SELECT p.short_code, p.type, p.likes_count, p.comments_count, p.shares_count,
            p.video_view_count, p.video_duration, p.product_type, p.transcript,
            p.display_url, p.posted_at, p.scraped_by, p.is_paid_partnership, a.username
       FROM posts p JOIN accounts a ON a.id = p.account_id
      ORDER BY a.username, p.short_code`
  );
  chequear(posts.length === 4, "4 filas en posts", posts.length);
  chequear(
    posts.every((p) => p.scraped_by === userId),
    "scraped_by apunta al dueño de la investigación"
  );

  const videos = posts.filter((p) => p.type === "Video");
  chequear(videos.length === 2, "2 videos", videos.length);
  chequear(
    videos.every((v) => v.video_view_count > 0 && v.video_duration > 0 && v.shares_count > 0),
    "los videos traen views, duración y shares (sólo apidojo los da)",
    videos.map((v) => ({ v: v.video_view_count, d: v.video_duration, s: v.shares_count }))
  );
  chequear(
    videos.every((v) => v.product_type === "clips" && v.transcript),
    "product_type y transcript poblados"
  );

  const imagenes = posts.filter((p) => p.type === "Image");
  chequear(
    imagenes.every((i) => i.video_view_count === null && i.video_duration === null),
    "una foto no inventa métricas de video",
    imagenes.map((i) => i.video_view_count)
  );

  // Hashtags y menciones via las funciones SQL que ya existian.
  const { rows: tags } = await pool.query(
    `SELECT h.tag, COUNT(*)::int AS usos
       FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id
      GROUP BY h.tag ORDER BY h.tag`
  );
  chequear(
    tags.length === 2 && tags.every((t) => t.tag === t.tag.toLowerCase()),
    "hashtags normalizados a minúsculas y deduplicados (Fitness/fitness → 1)",
    tags
  );
  chequear(
    tags.find((t) => t.tag === "fitness")?.usos === 2,
    "el hashtag compartido se relaciona con sus 2 posts",
    tags
  );
  chequear(tags.some((t) => t.tag === "gym"), "hashtag con espacios queda limpio", tags);

  const { rows: menciones } = await pool.query(
    `SELECT m.username FROM post_mentions pm JOIN mentions m ON m.id = pm.mention_id`
  );
  chequear(
    menciones.length === 1 && menciones[0].username === "coach",
    "menciones guardadas en minúsculas",
    menciones
  );

  const { rows: cuentasOk } = await pool.query(
    `SELECT username, posts_scraped, posts_scrape_status, last_updated_posts_scraped
       FROM accounts ORDER BY username`
  );
  chequear(
    cuentasOk.every((c) => c.posts_scraped === true && c.posts_scrape_status === "done"),
    "cuentas marcadas posts_scraped/done"
  );
  chequear(
    cuentasOk.every((c) => c.last_updated_posts_scraped !== null),
    "last_updated_posts_scraped seteada"
  );

  const { rows: run1 } = await pool.query(`SELECT * FROM scrape_runs WHERE id = $1`, [res1.runId]);
  chequear(run1[0].run_type === "posts", "scrape_run tipado como 'posts'", run1[0].run_type);
  chequear(run1[0].posts_scraped === 4, "posts_scraped = 4 en el run", run1[0].posts_scraped);
  chequear(run1[0].status === "completed", "run cerrado como completed", run1[0].status);

  // ═══ E2 — days_back → until ═══════════════════════════════
  console.log("\nE2 — days_back de la investigación llega como `until` a Apify");
  const input = estado.inputs.get("marca_a");
  const esperado = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  chequear(input?.until === esperado, `until = ${esperado} (days_back 30)`, input?.until);
  chequear(input?.maxItems === 200, "maxItems por defecto = 200", input?.maxItems);

  estado.feeds.set("marca_c", [{ type: "Image", diasAtras: 1 }]);
  const r2 = await crearResearch("corta", [{ username: "marca_c" }], 7);
  await scrapePostsForResearch(r2);
  const esperado7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  chequear(
    estado.inputs.get("marca_c")?.until === esperado7,
    `days_back 7 → until = ${esperado7}`,
    estado.inputs.get("marca_c")?.until
  );

  // ═══ E3 — idempotencia y upsert ═══════════════════════════
  console.log("\nE3 — re-corrida sin force");
  const llamadasAntes = estado.llamadas.get("marca_a") ?? 0;
  const res3 = await scrapePostsForResearch(r1);
  chequear(res3.claimed === 0, "no reclama: los posts ya están", res3.claimed);
  chequear((estado.llamadas.get("marca_a") ?? 0) === llamadasAntes, "no gastó créditos de nuevo");

  console.log("\nE3b — con force: actualiza contadores, NO duplica (LES-010)");
  // El mismo feed con mas likes: simula el paso del tiempo.
  estado.feeds.set("marca_a", [
    { type: "Video", diasAtras: 2, likesCount: 99_999, hashtags: ["Fitness"], mentions: ["Coach"] },
    { type: "Image", diasAtras: 5, likesCount: 88_888, hashtags: ["fitness"] },
    { type: "Video", diasAtras: 9, likesCount: 77_777, videoViewCount: 900_000 },
  ]);
  await pool.query(`UPDATE posts SET engagement_rate = 0.5, performance_score = 0.9`);

  const res3b = await scrapePostsForResearch(r1, { force: true });
  chequear(res3b.postsUpserted === 4, "reprocesa los 4", res3b.postsUpserted);

  const { rows: totalPosts } = await pool.query(`SELECT COUNT(*)::int AS n FROM posts`);
  chequear(totalPosts[0].n === 5, "sigue habiendo 5 posts en total, no 10", totalPosts[0].n);

  const { rows: actualizado } = await pool.query(
    `SELECT likes_count, engagement_rate, performance_score FROM posts
      WHERE likes_count = 99999`
  );
  chequear(actualizado.length === 1, "el contador se actualizó", actualizado.length);
  chequear(
    actualizado[0]?.engagement_rate === null && actualizado[0]?.performance_score === null,
    "las métricas viejas se blanquean para que el scoring las recalcule",
    actualizado[0]
  );

  const { rows: tagsPost } = await pool.query(`SELECT COUNT(*)::int AS n FROM post_hashtags`);
  chequear(tagsPost[0].n === 3, "las relaciones de hashtag no se duplican", tagsPost[0].n);

  // ═══ E4 — orden de etapas ═════════════════════════════════
  console.log("\nE4 — una cuenta sin perfil scrapeado NO entra (query de entrada del WF3)");
  estado.feeds.set("sin_perfil", [{ type: "Image", diasAtras: 1 }]);
  const r4 = await crearResearch("sin-perfil", [
    { username: "sin_perfil", perfilListo: false },
  ]);
  const res4 = await scrapePostsForResearch(r4);
  chequear(res4.claimed === 0, "no la reclama: scraped = FALSE", res4.claimed);
  chequear((estado.llamadas.get("sin_perfil") ?? 0) === 0, "no le pegó a Apify");

  // ═══ E5 — items con forma invalida ════════════════════════
  console.log("\nE5 — items basura en el feed: se descartan, el resto entra");
  estado.feeds.set("mixta", [{ type: "Image", diasAtras: 1 }, { type: "Video", diasAtras: 2 }]);
  estado.basura.set("mixta", [
    { shortCode: "XXinvalido", type: "Carousel", timestamp: new Date().toISOString() },
    { type: "Image", timestamp: new Date().toISOString() },
    null,
  ]);

  const r5 = await crearResearch("mixta", [{ username: "mixta" }]);
  const res5 = await scrapePostsForResearch(r5);
  chequear(res5.succeeded === 1, "la cuenta no falla por los items rotos", res5.succeeded);
  chequear(res5.postsUpserted === 2, "guarda los 2 válidos", res5.postsUpserted);
  chequear(res5.descartados === 3, "reporta los 3 descartados", res5.descartados);

  const { rows: tipos } = await pool.query(
    `SELECT DISTINCT type FROM posts ORDER BY type`
  );
  chequear(
    tipos.every((t) => ["Image", "Video", "Sidecar"].includes(t.type)),
    "ningún type inválido llegó a la tabla (respeta el CHECK)",
    tipos
  );

  // ═══ E6 — contadores ocultos ══════════════════════════════
  console.log("\nE6 — likesCount = -1 (cuenta que oculta los likes)");
  estado.feeds.set("oculta", [{ type: "Video", diasAtras: 1, likesCount: -1, sharesCount: -1 }]);
  const r6 = await crearResearch("oculta", [{ username: "oculta", followers: 10_000 }]);
  await scrapePostsForResearch(r6);

  const { rows: ocultos } = await pool.query(
    `SELECT p.likes_count, p.shares_count FROM posts p
       JOIN accounts a ON a.id = p.account_id WHERE a.username = 'oculta'`
  );
  chequear(
    ocultos[0].likes_count === 0 && ocultos[0].shares_count === 0,
    "el -1 se normaliza a 0: si no, el engagement_rate daría negativo",
    ocultos[0]
  );

  // ═══ E7 — scoring (ex WF4) ════════════════════════════════
  console.log("\nE7 — run_full_scoring() sobre lo scrapeado");
  await pool.query(`SELECT run_full_scoring()`);

  const { rows: sinMetrica } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM posts WHERE engagement_rate IS NULL`
  );
  chequear(sinMetrica[0].n === 0, "todos los posts tienen engagement_rate", sinMetrica[0].n);

  const { rows: calculado } = await pool.query(
    `SELECT p.engagement_rate, p.likes_count, p.comments_count, p.shares_count, a.followers_count
       FROM posts p JOIN accounts a ON a.id = p.account_id
      WHERE p.likes_count = 99999`
  );
  const fila = calculado[0];
  const esperadoER =
    (fila.likes_count + fila.comments_count + fila.shares_count) / fila.followers_count;
  chequear(
    Math.abs(fila.engagement_rate - esperadoER) < 0.0001,
    `engagement_rate = (likes+comments+shares)/followers = ${esperadoER.toFixed(4)}`,
    fila.engagement_rate
  );

  const { rows: scores } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM posts WHERE performance_score IS NULL`
  );
  chequear(scores[0].n === 0, "todos tienen performance_score", scores[0].n);

  // ═══ E8 — concurrencia ════════════════════════════════════
  console.log("\nE8 — dos corridas simultáneas sobre la misma investigación");
  const cuentas8 = ["k1", "k2", "k3", "k4", "k5", "k6"];
  for (const u of cuentas8) estado.feeds.set(u, [{ type: "Image", diasAtras: 1 }]);
  const r8 = await crearResearch("concurrente", cuentas8.map((username) => ({ username })));
  estado.llamadas.clear();

  const [a, b] = await Promise.all([
    scrapePostsForResearch(r8, { concurrency: 3 }),
    scrapePostsForResearch(r8, { concurrency: 3 }),
  ]);
  chequear(a.claimed + b.claimed === 6, `reclamaron 6 sin solaparse (${a.claimed} + ${b.claimed})`);
  const repetidas = cuentas8.filter((u) => (estado.llamadas.get(u) ?? 0) > 1);
  chequear(repetidas.length === 0, "ninguna cuenta se scrapeó dos veces", repetidas);

  // ═══ E9 — error fatal ═════════════════════════════════════
  console.log("\nE9 — sin créditos (402): aborta la corrida");
  for (const u of ["z1", "z2", "z3", "z4"]) estado.feeds.set(u, [{ type: "Image", diasAtras: 1 }]);
  const r9 = await crearResearch("sin-creditos", ["z1", "z2", "z3", "z4"].map((username) => ({ username })));
  estado.llamadas.clear();
  estado.forzarStatus = 402;

  let tiro = false;
  try {
    await scrapePostsForResearch(r9);
  } catch (error) {
    tiro = true;
    chequear((error as Error).name === "ApifyPaymentError", "propaga ApifyPaymentError", (error as Error).name);
  }
  chequear(tiro, "la corrida tira");
  estado.forzarStatus = undefined;

  const { rows: trabadas } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM accounts a
       JOIN research_accounts ra ON ra.account_id = a.id
      WHERE ra.research_id = $1 AND a.posts_scrape_status = 'running'`,
    [r9]
  );
  chequear(trabadas[0].n === 0, "ninguna cuenta quedó trabada en 'running'", trabadas[0].n);

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
