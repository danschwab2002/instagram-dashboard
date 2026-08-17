/** Instagram: letras, numeros, punto y guion bajo, hasta 30 caracteres. */
const IG_USERNAME_RE = /^[a-z0-9._]{1,30}$/;

/**
 * Deja un username de Instagram en su forma canonica, o null si no lo es.
 *
 * Acepta lo que la gente pega de verdad: "@user", "User", un link al perfil.
 * Normaliza a minusculas porque Instagram trata los usernames como
 * case-insensitive pero `accounts.username` es UNIQUE: sin esto, "Tesla" y
 * "tesla" crean dos filas para la misma cuenta.
 */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    // Un link de perfil suele traer barra final y a veces query params.
    .replace(/[/?#].*$/, "");

  return IG_USERNAME_RE.test(cleaned) ? cleaned : null;
}

/** Normaliza una lista descartando lo invalido y lo repetido. Preserva el orden. */
export function normalizeUsernames(input: unknown[]): string[] {
  const seen = new Set<string>();

  for (const raw of input) {
    const username = normalizeUsername(raw);
    if (username) seen.add(username);
  }

  return [...seen];
}
