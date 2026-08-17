/**
 * Cliente minimo de la API de Apify.
 *
 * Reemplaza el nodo HTTP Request del WF2 de n8n, con tres diferencias:
 *  - el token viaja por header Authorization, no en el query string (en el
 *    workflow viejo quedaba escrito en los logs de cualquier proxy intermedio);
 *  - los errores estan tipados, para poder distinguir "reintentar" de "abortar";
 *  - hay timeout propio: sin AbortController, un run colgado deja el fetch
 *    esperando para siempre.
 */

/**
 * Se puede apuntar a otro host con APIFY_API_BASE_URL para correr el pipeline
 * completo contra un doble de Apify, sin gastar creditos ni pegarle a Instagram.
 * En produccion queda sin definir y va contra la API real.
 */
const APIFY_API_BASE = process.env.APIFY_API_BASE_URL ?? "https://api.apify.com/v2";

/** Cuanto espera Apify a que el run termine antes de devolver 408. Tope de la API: 300s. */
const DEFAULT_WAIT_FOR_FINISH_SECS = 120;

/** Margen sobre waitForFinish para que corte Apify y no nosotros. */
const CLIENT_TIMEOUT_MARGIN_MS = 30_000;

const DEFAULT_MAX_ATTEMPTS = 3;

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retriable: boolean = false
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

/** Token ausente, invalido o sin permisos sobre el actor. Nunca se reintenta. */
export class ApifyAuthError extends ApifyError {
  constructor(message: string, status: number) {
    super(message, status, false);
    this.name = "ApifyAuthError";
  }
}

/** La cuenta de Apify se quedo sin creditos. Reintentar no ayuda. */
export class ApifyPaymentError extends ApifyError {
  constructor(message: string) {
    super(message, 402, false);
    this.name = "ApifyPaymentError";
  }
}

/** El run no termino dentro de la ventana. Suele resolverse reintentando. */
export class ApifyTimeoutError extends ApifyError {
  constructor(message: string) {
    super(message, 408, true);
    this.name = "ApifyTimeoutError";
  }
}

export interface RunActorOptions {
  /** Token de Apify. En este proyecto sale de user_profiles.apify_api_key. */
  token: string;
  /** Segundos que Apify espera al run. Default 120. */
  waitForFinishSecs?: number;
  /** Intentos totales, incluido el primero. Default 3. */
  maxAttempts?: number;
  /** Para cancelar desde afuera (ej. shutdown del proceso). */
  signal?: AbortSignal;
}

/**
 * Lanza un actor y devuelve los items de su dataset, en una sola llamada.
 *
 * Usa `run-sync-get-dataset-items`, que bloquea hasta que el run termina. Es el
 * endpoint que ya usaba el WF2 y evita tener que hacer polling del estado.
 *
 * @param actorId formato `usuario~nombre-del-actor`, ej. `apify~instagram-profile-scraper`
 */
export async function runActorSync<T = unknown>(
  actorId: string,
  input: Record<string, unknown>,
  options: RunActorOptions
): Promise<T[]> {
  const {
    token,
    waitForFinishSecs = DEFAULT_WAIT_FOR_FINISH_SECS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    signal,
  } = options;

  if (!token) {
    throw new ApifyAuthError("Falta el token de Apify", 401);
  }

  const url =
    `${APIFY_API_BASE}/acts/${actorId}/run-sync-get-dataset-items` +
    `?waitForFinish=${waitForFinishSecs}`;

  let lastError: ApifyError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestOnce<T>(url, input, token, waitForFinishSecs, signal);
    } catch (error) {
      // Una cancelacion externa no es un fallo del scraping: se propaga tal cual.
      if (error instanceof DOMException && error.name === "AbortError" && signal?.aborted) {
        throw error;
      }

      const apifyError =
        error instanceof ApifyError
          ? error
          : new ApifyError(
              `Fallo de red contra Apify: ${(error as Error).message}`,
              undefined,
              true
            );

      if (!apifyError.retriable || attempt === maxAttempts) {
        throw apifyError;
      }

      lastError = apifyError;
      // Backoff exponencial: 1s, 2s, 4s...
      await sleep(1000 * 2 ** (attempt - 1), signal);
    }
  }

  throw lastError ?? new ApifyError("Apify agoto los reintentos");
}

async function requestOnce<T>(
  url: string,
  input: Record<string, unknown>,
  token: string,
  waitForFinishSecs: number,
  externalSignal?: AbortSignal
): Promise<T[]> {
  const timeout = AbortSignal.timeout(
    waitForFinishSecs * 1000 + CLIENT_TIMEOUT_MARGIN_MS
  );
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeout])
    : timeout;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok) {
    throw await toApifyError(response);
  }

  const payload: unknown = await response.json();

  // El endpoint devuelve el dataset como array. Cualquier otra cosa significa
  // que Apify cambio el contrato o que un proxy devolvio algo distinto.
  if (!Array.isArray(payload)) {
    throw new ApifyError(
      `Apify devolvio ${typeof payload} en vez de un array de items`
    );
  }

  return payload as T[];
}

async function toApifyError(response: Response): Promise<ApifyError> {
  const detail = await readErrorMessage(response);

  switch (response.status) {
    case 401:
    case 403:
      return new ApifyAuthError(`Token de Apify rechazado: ${detail}`, response.status);
    case 402:
      return new ApifyPaymentError(`Sin creditos en la cuenta de Apify: ${detail}`);
    case 404:
      return new ApifyError(`Actor inexistente: ${detail}`, 404, false);
    case 408:
      return new ApifyTimeoutError(`El run de Apify no termino a tiempo: ${detail}`);
    case 429:
      return new ApifyError(`Rate limit de Apify: ${detail}`, 429, true);
    default:
      return new ApifyError(
        `Apify respondio ${response.status}: ${detail}`,
        response.status,
        // Los 5xx son transitorios; los 4xx restantes son culpa del request.
        response.status >= 500
      );
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      return parsed.error?.message ?? body.slice(0, 300);
    } catch {
      return body.slice(0, 300);
    }
  } catch {
    return response.statusText;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}
