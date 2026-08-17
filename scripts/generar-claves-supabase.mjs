#!/usr/bin/env node
/**
 * Genera las claves que necesita el stack Postgres + GoTrue.
 *
 *   node scripts/generar-claves-supabase.mjs
 *
 * Imprime tres valores:
 *   JWT_SECRET   → va en GoTrue (GOTRUE_JWT_SECRET)
 *   ANON_KEY     → va en la app (NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *   SERVICE_KEY  → clave de servicio; NO la pongas en el frontend
 *
 * Las dos ultimas son JWT firmados con el JWT_SECRET: por eso los tres valores
 * van juntos. Si rotas el secreto, tenes que regenerar las otras dos.
 *
 * Pasa --secret <valor> para regenerar las claves de un secreto que ya tenias.
 */
import { createHmac, randomBytes } from "node:crypto";

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function firmarJWT(payload, secreto) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const cuerpo = b64url(JSON.stringify(payload));
  const firma = createHmac("sha256", secreto)
    .update(`${header}.${cuerpo}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${cuerpo}.${firma}`;
}

const argv = process.argv.slice(2);
const indiceSecreto = argv.indexOf("--secret");
const secreto =
  indiceSecreto >= 0 ? argv[indiceSecreto + 1] : randomBytes(32).toString("hex");

const ahora = Math.floor(Date.now() / 1000);
const diezAnios = ahora + 60 * 60 * 24 * 365 * 10;

const anon = firmarJWT({ role: "anon", iss: "supabase", iat: ahora, exp: diezAnios }, secreto);
const service = firmarJWT(
  { role: "service_role", iss: "supabase", iat: ahora, exp: diezAnios },
  secreto
);

console.log(`
# ── GoTrue ─────────────────────────────────────────────
GOTRUE_JWT_SECRET=${secreto}

# ── App (Next) ─────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}

# ── Backend only — NUNCA en el frontend ────────────────
SUPABASE_SERVICE_ROLE_KEY=${service}
`);
