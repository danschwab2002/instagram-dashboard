#!/usr/bin/env bash
#
# Levanta un Postgres local con el schema completo de la app, para desarrollo.
#
#   bash scripts/db-local.sh          # crea el contenedor si no existe y aplica el schema
#   bash scripts/db-local.sh --reset  # borra TODO y reconstruye de cero
#   bash scripts/db-local.sh --stop   # apaga el contenedor (los datos quedan)
#
# Deja la base en:
#   postgresql://postgres:devlocal@localhost:5434/instagram_scraper
#
# El puerto 5434 evita chocar con otros Postgres que puedan estar corriendo.
#
# NOTA: crea un `auth.users` mínimo como stub. NO es Supabase Auth — sólo
# satisface las foreign keys de datasets/ai_sessions/ig_connections. Para
# probar la UI con login real hace falta el stack de Supabase.

set -euo pipefail

CONTENEDOR="ig-scraper-pg"
PUERTO=5434
DB="instagram_scraper"
PASS="devlocal"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

psql_run() { docker exec -i "$CONTENEDOR" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

case "${1:-}" in
  --stop)
    docker stop "$CONTENEDOR" >/dev/null && echo "contenedor detenido"
    exit 0
    ;;
  --reset)
    docker rm -f "$CONTENEDOR" >/dev/null 2>&1 || true
    echo "contenedor eliminado"
    ;;
esac

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
  echo "creando contenedor $CONTENEDOR en el puerto $PUERTO..."
  docker run -d --name "$CONTENEDOR" \
    -e POSTGRES_PASSWORD="$PASS" \
    -e POSTGRES_DB="$DB" \
    -p "${PUERTO}:5432" \
    postgres:17 >/dev/null
elif ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
  echo "arrancando contenedor existente..."
  docker start "$CONTENEDOR" >/dev/null
fi

printf "esperando a Postgres"
for _ in $(seq 1 60); do
  if docker exec "$CONTENEDOR" pg_isready -U postgres -d "$DB" >/dev/null 2>&1; then
    echo " listo"
    break
  fi
  printf "."
  sleep 1
done

echo "aplicando stub de auth.users..."
psql_run <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE
);
SQL

echo "aplicando schema.sql..."
psql_run < "$DIR/db/schema.sql" >/dev/null

echo "aplicando migraciones..."
for archivo in "$DIR"/db/migrations/*.sql; do
  printf "  %s" "$(basename "$archivo")"
  psql_run < "$archivo" >/dev/null
  echo " ok"
done

echo "aplicando functions.sql..."
psql_run < "$DIR/db/functions.sql" >/dev/null

TABLAS=$(psql_run -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d ' ')

cat <<EOF

listo — $TABLAS tablas en public

  DATABASE_URL="postgresql://postgres:${PASS}@localhost:${PUERTO}/${DB}"

Para correr el scraping de perfiles contra esta base:
  DATABASE_URL="..." npx tsx scripts/scrape-profiles.ts --research <id>
EOF
