import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // La app hace de proxy de GoTrue en /auth/v1/* (ver next.config.ts), asi que
  // el SDK tiene que apuntar al mismo origen desde el que se sirvio la pagina.
  //
  // Tomarlo de window en vez de una NEXT_PUBLIC_* desata el build del dominio:
  // esas variables se hornean en tiempo de build (LES-012), asi que cambiar de
  // dominio obligaria a rebuildear la imagen entera.
  // En el render del servidor no hay `window`. El cliente de navegador no hace
  // pedidos de auth durante el prerender, pero exige una URL no vacia para
  // construirse: sin este fallback, la pagina de login tira 500.
  const url =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:3000";

  return createBrowserClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
