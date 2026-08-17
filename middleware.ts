import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // El origen del propio request: la app hace de proxy de GoTrue en /auth/v1/*
  // (ver next.config.ts), asi que este es siempre el destino correcto y no
  // depende de ninguna variable horneada en build. SUPABASE_INTERNAL_URL lo
  // pisa para evitar el rodeo por internet cuando esta definida.
  const supabaseUrl =
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    request.nextUrl.origin;

  const supabase = createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Si no hay usuario y no está en /login ni /auth, redirigir a login
  const path = request.nextUrl.pathname;
  if (!user && path !== "/login" && !path.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Si hay usuario y está en /login, redirigir a home
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // `auth/v1` queda EXCLUIDO a proposito: es el proxy hacia GoTrue, y el
    // propio middleware le pega a esa ruta cuando llama a getUser(). Sin la
    // exclusion cada request se interceptaria a si mismo en loop.
    "/((?!_next/static|_next/image|favicon.ico|auth/v1|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
