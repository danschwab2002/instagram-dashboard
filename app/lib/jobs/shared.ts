/** Piezas comunes a los jobs de scraping. */

/**
 * Corre `worker` sobre todos los items con como maximo `limit` en vuelo.
 *
 * `limit` workers compiten por un cursor compartido, asi ninguno espera al lote
 * entero como haria un Promise.all por chunks: apenas uno termina, agarra el
 * siguiente item libre.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    }
  );

  await Promise.all(runners);
}

/** Distingue una cancelacion deliberada de un fallo real. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Mensaje legible para guardar en la columna de error. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
