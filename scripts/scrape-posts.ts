#!/usr/bin/env tsx
/**
 * Corre el scraping de posts de una investigacion desde la terminal.
 *
 * Es el equivalente al boton "Execute Workflow" que tenia el WF3 en n8n.
 * Requiere que los perfiles ya esten scrapeados (el job filtra por
 * `scraped = TRUE`): corré antes `scrape:profiles` si hace falta.
 *
 *   npm run scrape:posts -- --research 42
 *   npm run scrape:posts -- --research 42 --max-posts 50 --force
 *
 * La ventana de dias sale de `researches.days_back`, no de un flag: es lo que
 * el usuario eligio al crear la investigacion.
 */

import { pool } from "../app/lib/pool";
import { scrapePostsForResearch } from "../app/lib/jobs/scrape-posts";

interface Args {
  research: number;
  concurrency?: number;
  maxPosts?: number;
  token?: string;
  force: boolean;
  scoring: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const research = Number(get("--research") ?? get("-r"));
  if (!Number.isInteger(research) || research <= 0) {
    console.error(
      "Falta --research <id>.\n\n" +
        "  npm run scrape:posts -- --research 42 [--concurrency 2] [--max-posts 200] [--token ...] [--force] [--sin-scoring]\n"
    );
    process.exit(1);
  }

  const concurrency = get("--concurrency");
  const maxPosts = get("--max-posts");

  return {
    research,
    concurrency: concurrency ? Number(concurrency) : undefined,
    maxPosts: maxPosts ? Number(maxPosts) : undefined,
    token: get("--token"),
    force: argv.includes("--force"),
    scoring: !argv.includes("--sin-scoring"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL. Corré con: tsx --env-file=.env ...");
    process.exit(1);
  }

  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.log("\nCancelando… (las cuentas sin procesar vuelven a la cola)");
    controller.abort();
  });

  const startedAt = Date.now();
  console.log(`Scrapeando posts de la investigación ${args.research}…`);

  const result = await scrapePostsForResearch(args.research, {
    apifyToken: args.token,
    concurrency: args.concurrency,
    maxPosts: args.maxPosts,
    force: args.force,
    signal: controller.signal,
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.claimed === 0) {
    console.log(
      "No había cuentas pendientes.\n" +
        "  · Si los perfiles no están scrapeados todavía, corré antes: npm run scrape:profiles\n" +
        "  · Si ya se scrapearon los posts, usá --force para rehacerlos."
    );
    return;
  }

  console.log(
    `\nrun #${result.runId} — ${result.postsUpserted} posts de ` +
      `${result.succeeded}/${result.claimed} cuentas en ${seconds}s`
  );
  if (result.descartados > 0) {
    console.log(`  ${result.descartados} items descartados por forma inesperada`);
  }
  if (result.skipped > 0) {
    console.log(`  ${result.skipped} cuentas sin procesar (devueltas a la cola)`);
  }
  if (result.failures.length > 0) {
    console.log(`\n  ${result.failures.length} fallaron:`);
    for (const failure of result.failures) {
      console.log(`    @${failure.username} — ${failure.error}`);
    }
  }

  if (args.scoring && result.postsUpserted > 0) {
    await pool.query(`SELECT run_full_scoring()`);
    console.log("\nscoring aplicado (engagement_rate + performance_score)");
  }
}

main()
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
