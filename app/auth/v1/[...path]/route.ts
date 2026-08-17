import { NextRequest } from "next/server";

/**
 * Proxy hacia GoTrue.
 *
 * El SDK de Supabase pega siempre a `<URL>/auth/v1/*`, pero GoTrue sirve en la
 * raiz (`/token`, `/signup`, `/user`). En el stack completo de Supabase esa
 * traduccion la hace Kong; corriendo solo Postgres + GoTrue, la hace esto.
 *
 * Va como route handler y NO como `rewrites()` de next.config a proposito: los
 * rewrites se resuelven en tiempo de BUILD, asi que la direccion de GoTrue
 * quedaria horneada en la imagen. Aca `GOTRUE_URL` se lee en cada request, que
 * es lo que permite mover o renombrar el servicio sin rebuildear.
 *
 * Beneficio de lado: el navegador nunca le habla a GoTrue directo — mismo
 * origen, sin CORS, y GoTrue puede quedarse sin dominio publico.
 *
 * ⚠ El middleware excluye `auth/v1` de su matcher. Sin esa exclusion, su propia
 * llamada a getUser() vuelve a entrar por aca y se cicla.
 */

export const dynamic = "force-dynamic";

/** Cabeceras que pertenecen a la conexion y no deben reenviarse. */
const HEADERS_A_SALTEAR = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "content-length",
]);

function filtrarHeaders(fuente: Headers): Headers {
  const salida = new Headers();
  fuente.forEach((valor, nombre) => {
    if (!HEADERS_A_SALTEAR.has(nombre.toLowerCase())) salida.set(nombre, valor);
  });
  return salida;
}

async function proxy(
  request: NextRequest,
  contexto: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const base = process.env.GOTRUE_URL;

  if (!base) {
    return Response.json(
      { error: "GOTRUE_URL no está configurada en el servidor" },
      { status: 500 }
    );
  }

  const { path } = await contexto.params;
  const destino = new URL(`${base.replace(/\/$/, "")}/${path.join("/")}`);
  destino.search = request.nextUrl.search;

  // GET y HEAD no llevan cuerpo; leerlo tira en runtime.
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  try {
    const respuesta = await fetch(destino, {
      method: request.method,
      headers: filtrarHeaders(request.headers),
      body,
      // Los redirects los resuelve el cliente, no este proxy.
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    return new Response(respuesta.body, {
      status: respuesta.status,
      statusText: respuesta.statusText,
      headers: filtrarHeaders(respuesta.headers),
    });
  } catch (error) {
    console.error(`[auth proxy] ${request.method} ${destino.pathname} falló:`, error);
    return Response.json(
      { error: "No se pudo contactar al servicio de autenticación" },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
