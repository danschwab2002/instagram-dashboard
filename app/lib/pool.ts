import { Pool } from "pg";

// Cada route handler creaba su propio Pool (max: 5). Con ~8 handlers eso son
// 40 conexiones potenciales contra un Postgres que por defecto acepta 100,
// y en dev el HMR de Next reevalua los modulos dejando pools huerfanos que
// nunca cierran sus conexiones. El singleton en globalThis lo evita.
const globalForPool = globalThis as unknown as { __pgPool?: Pool };

export const pool =
  globalForPool.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    // Sin esto, si la DB no responde el await queda colgado indefinidamente
    // tomando un slot del pool.
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPool.__pgPool = pool;
}

/**
 * Corre `fn` dentro de una transaccion, con COMMIT/ROLLBACK y release
 * garantizados. La conexion se libera incluso si `fn` tira.
 */
export async function withTransaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      // Si el ROLLBACK falla la conexion ya esta rota; el release la descarta.
      // Tragarlo evita enmascarar el error original.
    });
    throw error;
  } finally {
    client.release();
  }
}
