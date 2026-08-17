FROM node:20-alpine AS base

# ── Build ───────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Las NEXT_PUBLIC_* se hornean en el bundle del cliente en tiempo de BUILD
# (LES-012), asi que entran como build args y no como variables del servicio.
#
# Antes estaban hardcodeadas apuntando al Supabase viejo, con la anon key de
# demo adentro del repo. Ahora se pasan desde afuera:
#   --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#
# NEXT_PUBLIC_SUPABASE_URL es opcional: en el navegador la app usa su propio
# origen (ver app/lib/supabase/browser.ts), asi que la imagen no queda atada a
# un dominio. Solo hace falta si algo la necesita durante el prerender.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Runtime ─────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
