#!/usr/bin/env bash
#
# Aplica el schema a la base del servidor, por SSH, sin exponer Postgres.
#
# Los archivos .sql viajan por el tunel SSH directo al psql del contenedor: no
# hay que copiarlos al VPS ni abrir el puerto 5432 a internet.
#
#   bash scripts/db-deploy.sh root@169.58.82.7 --auth   # ANTES de arrancar GoTrue
#   bash scripts/db-deploy.sh root@169.58.82.7 --app    # DESPUES de arrancar GoTrue
#
# El orden importa: --auth crea el rol y el schema que GoTrue necesita para
# arrancar; --app monta las tablas de la aplicacion, que tienen foreign keys
# contra la auth.users que crea GoTrue al levantar.
#
# Variables opcionales:
#   SERVICIO=infra_ig-db        nombre del servicio de Postgres en EasyPanel
#   BASE=instagram_scraper      nombre de la base
#   USUARIO=postgres            usuario de Postgres

set -euo pipefail

SSH_HOST="${1:-}"
PASO="${2:-}"
SERVICIO="${SERVICIO:-infra_ig-db}"
BASE="${BASE:-instagram_scraper}"
USUARIO="${USUARIO:-postgres}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$SSH_HOST" || ! "$PASO" =~ ^--(auth|app)$ ]]; then
  cat <<'AYUDA'
Uso:
  bash scripts/db-deploy.sh <usuario@servidor> --auth   # antes de arrancar GoTrue
  bash scripts/db-deploy.sh <usuario@servidor> --app    # despues de arrancar GoTrue

Variables opcionales: SERVICIO, BASE, USUARIO
AYUDA
  exit 1
fi

# EasyPanel corre sobre Docker Swarm: el contenedor real se llama
# <servicio>.1.<hash>, asi que se busca por prefijo en vez de por nombre exacto.
remoto() {
  ssh "$SSH_HOST" \
    "CID=\$(docker ps -qf name=${SERVICIO} | head -1); \
     if [ -z \"\$CID\" ]; then echo 'No encontre el contenedor ${SERVICIO}' >&2; exit 1; fi; \
     docker exec -i \$CID psql -U ${USUARIO} -d ${BASE} -v ON_ERROR_STOP=1 -q"
}

aplicar() {
  local archivo="$1"
  printf "  %-42s" "$(basename "$archivo")"
  if remoto < "$archivo" >/dev/null 2>/tmp/db-deploy-err; then
    echo "ok"
  else
    echo "FALLA"
    sed 's/^/      /' /tmp/db-deploy-err
    exit 1
  fi
}

echo "servidor : $SSH_HOST"
echo "servicio : $SERVICIO"
echo "base     : $BASE"
echo ""

if [[ "$PASO" == "--auth" ]]; then
  # La contraseña se pide por stdin: no queda en el historial del shell ni
  # escrita en el archivo .sql del repo.
  read -rsp "Contraseña para el rol supabase_auth_admin: " PASSWORD
  echo ""
  echo ""

  if [[ -z "$PASSWORD" ]]; then
    echo "La contraseña no puede estar vacía." >&2
    exit 1
  fi

  # Dentro de un literal SQL, una comilla simple se escribe duplicada.
  # Va por variable: dentro de comillas dobles, bash lee \' como barra+comilla,
  # no como comilla escapada, y el reemplazo sale mal.
  COMILLA="'"
  SQL_SEGURA="${PASSWORD//${COMILLA}/${COMILLA}${COMILLA}}"

  # Escapes para sed, en este orden: la barra invertida primero (si no, se
  # re-escapa a si misma), despues & (que en el reemplazo significa "todo lo
  # encontrado") y por ultimo la barra, que es el delimitador.
  ESCAPADA="${SQL_SEGURA//\\/\\\\}"
  ESCAPADA="${ESCAPADA//&/\\&}"
  ESCAPADA="${ESCAPADA//\//\\/}"

  echo "aplicando preparación de auth:"
  TEMP="$(mktemp)"
  trap 'rm -f "$TEMP"' EXIT
  sed "s/'CAMBIAME'/'${ESCAPADA}'/" "$DIR/db/00_auth_prepare.sql" > "$TEMP"
  aplicar "$TEMP"

  cat <<FIN

Listo. Ahora, EN ESTE ORDEN:
  1. Poné esa misma contraseña en GOTRUE_DB_DATABASE_URL del servicio ig-auth
  2. Desplegá ig-auth y confirmá en los logs: "GoTrue API started on: 0.0.0.0:9999"
  3. Volvé con:  bash scripts/db-deploy.sh $SSH_HOST --app
FIN
  exit 0
fi

# ── --app ────────────────────────────────────────────────────
echo "verificando que GoTrue ya haya creado auth.users..."
if ! echo "SELECT 1 FROM auth.users LIMIT 1;" | remoto >/dev/null 2>&1; then
  cat <<'ERROR' >&2

  auth.users no existe todavía.

  Las tablas de la app tienen foreign keys contra esa tabla, así que hay que
  arrancar GoTrue primero y esperar a que corra sus migraciones. Revisá que el
  servicio ig-auth esté verde y que su log diga "GoTrue API started".
ERROR
  exit 1
fi
echo "  ok — auth.users existe"
echo ""

echo "aplicando schema de la aplicación:"
aplicar "$DIR/db/schema.sql"
for archivo in "$DIR"/db/migrations/*.sql; do
  aplicar "$archivo"
done
aplicar "$DIR/db/functions.sql"

echo ""
echo "tablas creadas:"
echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  | remoto | sed 's/^/  /'
