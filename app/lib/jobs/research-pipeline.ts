import { pool } from "../pool";
import { scrapeProfilesForResearch } from "./scrape-profiles";
import { scrapePostsForResearch } from "./scrape-posts";

/**
 * El pipeline completo de una investigacion, de punta a punta.
 *
 * Reemplaza al workflow orquestador de n8n (el que colgaba del webhook
 * N8N_RESEARCH_WEBHOOK_URL): en vez de un HTTP POST a otro sistema, las etapas
 * se llaman en orden desde este proceso.
 *
 * Etapas:
 *   1. Perfiles (ex WF2)  ✅ portado
 *   2. Posts    (ex WF3)  ✅ portado
 *   3. Scoring  (ex WF4)  ✅ portado — ya era SQL, `SELECT run_full_scoring()`
 *   4. Videos   (ex WF3b) ⏳ pendiente — descarga a Storage
 *
 * El orden importa: los posts necesitan `followers_count` del perfil para su
 * engagement_rate, y el scoring necesita los posts ya guardados.
 *
 * Mientras falten etapas, la investigacion se marca 'completed' al terminar las
 * que SI existen: es lo unico honesto que puede reportar la UI hoy.
 *
 * No tira nunca: corre en background (ver `after()` en /api/researches) y una
 * excepcion sin capturar ahi solo ensucia los logs del server. El estado real
 * queda en `researches.status` y en la tabla `scrape_runs`.
 */
export async function runResearchPipeline(researchId: number): Promise<void> {
  const label = `[research ${researchId}]`;
  const startedAt = Date.now();

  try {
    console.log(`${label} pipeline: arrancando scraping de perfiles`);

    const profiles = await scrapeProfilesForResearch(researchId);

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `${label} perfiles: ${profiles.succeeded}/${profiles.claimed} en ${seconds}s` +
        (profiles.failed > 0 ? ` — ${profiles.failed} fallaron` : "")
    );

    for (const failure of profiles.failures) {
      console.warn(`${label} @${failure.username}: ${failure.error}`);
    }

    // Sin un solo perfil no hay followers_count, y sin eso el engagement_rate
    // de todos los posts daria cero. `scrapeProfilesForResearch` ya la marco
    // 'failed'; seguir seria gastar creditos para guardar metricas invalidas.
    if (profiles.succeeded === 0 && profiles.failed > 0) {
      console.error(`${label} ningun perfil se scrapeo: no se siguen los posts`);
      return;
    }

    console.log(`${label} pipeline: arrancando scraping de posts`);
    const posts = await scrapePostsForResearch(researchId);

    console.log(
      `${label} posts: ${posts.postsUpserted} de ${posts.succeeded}/${posts.claimed} cuentas` +
        (posts.failed > 0 ? ` — ${posts.failed} fallaron` : "") +
        (posts.descartados > 0 ? ` — ${posts.descartados} items descartados` : "")
    );

    for (const failure of posts.failures) {
      console.warn(`${label} @${failure.username}: ${failure.error}`);
    }

    // WF4: engagement_rate + performance_score. Es SQL que ya existia en
    // db/functions.sql, nunca hubo nada que portar.
    if (posts.postsUpserted > 0) {
      await pool.query(`SELECT run_full_scoring()`);
      console.log(`${label} scoring aplicado`);
    }

    // TODO(WF3b): descarga de videos a Storage.

    await markResearchCompleted(researchId);
  } catch (error) {
    // Los errores fatales (token invalido, sin creditos) ya dejaron la
    // investigacion en 'failed' antes de propagarse hasta aca.
    console.error(
      `${label} pipeline abortado: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function markResearchCompleted(researchId: number): Promise<void> {
  await pool.query(
    `UPDATE researches SET status = 'completed' WHERE id = $1 AND status <> 'failed'`,
    [researchId]
  );
}
