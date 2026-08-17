import type { NextConfig } from "next";

/**
 * El proxy hacia GoTrue NO vive aca.
 *
 * `rewrites()` se resuelve en tiempo de build, asi que la direccion de GoTrue
 * quedaria horneada en la imagen y habria que rebuildear para cambiarla. En su
 * lugar es un route handler que lee GOTRUE_URL en cada request:
 * app/auth/v1/[...path]/route.ts
 */
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
