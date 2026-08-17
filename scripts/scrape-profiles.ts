#!/usr/bin/env tsx
/**
 * Corre el scraping de perfiles de una investigacion desde la terminal.
 *
 * Es el equivalente al boton "Execute Workflow" que tenia el WF2 en n8n: sirve
 * para probar el job sin pasar por la app, y para reintentar a mano una
 * investigacion que quedo a medias.
 *
 *   npm run scrape:profiles -- --research 42
 *   npm run scrape:profiles -- --research 42 --concurrency 5 --force
 *
 * Requiere DATABASE_URL. El token de Apify sale de user_profiles (el dueno de
 * la investigacion); se puede pisar con --token o con APIFY_TOKEN.
 */

import { pool } from "../app/lib/pool";
import { scrapeProfilesForResearch } from "../app/lib/jobs/scrape-profiles";

interface Args {
  research: number;
  concurrency?: number;
  token?: string;
  force: boolean;
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
        "  npm run scrape:profiles -- --research 42 [--concurrency 3] [--token ...] [--force]\n"
    );
    process.exit(1);
  }

  const concurrencyRaw = get("--concurrency");

  return {
    research,
    concurrency: concurrencyRaw ? Number(concurrencyRaw) : undefined,
    token: get("--token"),
    force: argv.includes("--force"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL. Corré con: tsx --env-file=.env ...");
    process.exit(1);
  }

  // Ctrl-C corta limpio: las cuentas reclamadas vuelven a 'pending'.
  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.log("\nCancelando… (las cuentas sin procesar vuelven a la cola)");
    controller.abort();
  });

  const startedAt = Date.now();
  console.log(`Scrapeando perfiles de la investigación ${args.research}…`);

  const result = await scrapeProfilesForResearch(args.research, {
    apifyToken: args.token,
    concurrency: args.concurrency,
    force: args.force,
    signal: controller.signal,
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.claimed === 0) {
    console.log("No había cuentas pendientes. Usá --force para re-scrapear.");
    return;
  }

  console.log(
    `\nrun #${result.runId} — ${result.succeeded}/${result.claimed} perfiles en ${seconds}s`
  );
  if (result.skipped > 0) {
    console.log(`  ${result.skipped} sin procesar (devueltas a la cola)`);
  }
  if (result.failures.length > 0) {
    console.log(`\n  ${result.failures.length} fallaron:`);
    for (const failure of result.failures) {
      console.log(`    @${failure.username} — ${failure.error}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
