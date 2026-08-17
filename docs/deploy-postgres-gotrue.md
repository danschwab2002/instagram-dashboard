# Deploy: Postgres + GoTrue en EasyPanel

Cómo levantar la base de datos y la autenticación sin el stack completo de
Supabase. Son **dos servicios** en vez de los diez que trae Supabase self-hosted.

Todo lo de acá abajo está **probado end-to-end en local** antes de escribirse:
GoTrue creando usuarios, el pipeline de scraping corriendo, y el dashboard
resolviendo `owner_email` con el JOIN contra `auth.users`.

## Por qué GoTrue y no sólo Postgres

La app tiene el schema de auth cosido al SQL del producto:

- **3 foreign keys** apuntan a `auth.users` (`datasets`, `ai_sessions`, `ig_connections`)
- **5 queries de `app/lib/db.ts`** hacen JOIN contra `auth.users` para resolver
  el email del dueño de cada post — una de ellas dentro de `getPosts()`, la
  query principal del dashboard

`auth.users` la crea y la mantiene GoTrue. Un Postgres pelado no la tiene, así
que sin GoTrue habría que reescribir el login **y** esas 5 queries.

---

## 1. Servicio Postgres

Template de Postgres de EasyPanel.

| Campo | Valor |
|---|---|
| Nombre | `ig-db` |
| Imagen | `postgres:17` |
| Base | `instagram_scraper` |

Anotá el usuario, la contraseña y el **host interno** que te muestra EasyPanel
(suele ser el nombre del servicio). No hace falta exponer el puerto a internet:
los otros servicios lo alcanzan por la red interna del proyecto.

## 2. Preparar el schema `auth` — antes de GoTrue

⚠ **El orden importa.** Si GoTrue arranca antes que esto, las tablas de auth
quedan con el dueño equivocado y falla con `must be owner of table users`.

Abrí la consola de Postgres en EasyPanel y corré [`db/00_auth_prepare.sql`](../db/00_auth_prepare.sql),
**cambiando antes el `CAMBIAME`** por la contraseña que vas a usar para GoTrue.

Ese archivo crea los roles, y sobre todo hace dos cosas que no son obvias:

- `ALTER ROLE supabase_auth_admin SET search_path TO auth, public` — GoTrue
  consulta `users`, no `auth.users`. Sin esto tira `relation "users" does not exist`.
- `CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin` — el schema tiene que
  **nacer** con GoTrue como dueño, no cambiárselo después.

## 3. Servicio GoTrue

Servicio tipo **App** con imagen Docker. **Sin dominio público**: queda interno,
la app le hace de proxy (paso 5).

| Campo | Valor |
|---|---|
| Nombre | `ig-auth` |
| Imagen | `public.ecr.aws/supabase/gotrue:v2.194.0` |
| Puerto | `9999` |

Generá las claves con:

```bash
node scripts/generar-claves-supabase.mjs
```

Te imprime `GOTRUE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY`. **Los tres van juntos**: las dos últimas son JWT
firmados con el primero, así que si rotás el secreto hay que regenerarlas.

Variables de entorno del servicio:

```
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:LA_PASSWORD@ig-db:5432/instagram_scraper?sslmode=disable
GOTRUE_JWT_SECRET=<el generado>
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_SITE_URL=https://tu-dominio-de-la-app
GOTRUE_API_HOST=0.0.0.0
PORT=9999
API_EXTERNAL_URL=https://tu-dominio-de-la-app
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_DISABLE_SIGNUP=false
```

Sobre las dos últimas:

- `MAILER_AUTOCONFIRM=true` evita necesitar SMTP: el usuario queda confirmado al
  crearse. Si después querés mails de verificación, configurás SMTP y lo ponés en `false`.
- `DISABLE_SIGNUP=false` deja crear cuentas. **Cuando termines de dar de alta a
  los usuarios, ponelo en `true`** o cualquiera con la URL puede registrarse.

Arrancá el servicio y mirá los logs. Tiene que decir `GoTrue API started on: 0.0.0.0:9999`
y ningún `fatal`.

## 4. Schema de la aplicación

Recién ahora, y en este orden:

```
db/schema.sql
db/migrations/001 … 019    (en orden numérico)
db/functions.sql
```

Verificado: la secuencia completa corre limpia sobre una base vacía y deja **26+
tablas**. `db/migrations/019` es la que trae las columnas que el dashboard
consulta y que se habían perdido (`stored_url`, `analysis_status`, etc.).

## 5. Servicio de la app Next

Servicio tipo **App**, fuente **Dockerfile** desde el repo de GitHub. Este sí
lleva dominio público.

### Build arg (uno solo)

```
NEXT_PUBLIC_SUPABASE_ANON_KEY=<el generado>
```

Va como **build arg**, no como variable del servicio: las `NEXT_PUBLIC_*` se
hornean en el bundle del cliente en tiempo de build (LES-012). Cambiarla exige
rebuild.

> Antes el Dockerfile las tenía **hardcodeadas** apuntando al Supabase viejo
> (`rainmakers-supabase-rein...`) con la anon key de demo escrita en el repo. Ya
> no: entran desde afuera.

### Variables del servicio (runtime)

```
DATABASE_URL=postgres://postgres:LA_PASSWORD@infra_ig-db:5432/instagram_scraper
GOTRUE_URL=http://infra_ig-auth:9999
SUPABASE_INTERNAL_URL=http://localhost:3000
```

Eso es todo. **`NEXT_PUBLIC_SUPABASE_URL` no hace falta**: en el navegador la app
usa su propio origen (`window.location.origin`), así que la imagen no queda
atada a ningún dominio y podés cambiarlo sin rebuildear.

### Cómo llega el navegador a GoTrue

El SDK pega siempre a `<origen>/auth/v1/*` y GoTrue sirve en la raíz. Esa
traducción la hace [`app/auth/v1/[...path]/route.ts`](../app/auth/v1/[...path]/route.ts),
que reenvía a `GOTRUE_URL` por la red interna. Reemplaza a Kong, evita el CORS y
deja a GoTrue sin dominio público.

Está como **route handler y no como `rewrites()` de next.config** por un motivo
concreto: los rewrites se resuelven en build, así que la dirección de GoTrue
quedaría horneada en la imagen. Acá se lee en cada request.

⚠ El matcher de `middleware.ts` **excluye `auth/v1`**. Sin esa exclusión, la
llamada a `getUser()` del propio middleware vuelve a entrar por el proxy y se
cicla. Si tocás el matcher, mantené la exclusión.

## 6. Crear el primer usuario

```bash
curl -X POST https://tu-dominio-de-la-app/auth/v1/signup \
  -H "Content-Type: application/json" \
  -H "apikey: <ANON_KEY>" \
  -d '{"email":"vos@dominio.com","password":"unaClaveLarga"}'
```

Si responde con un `user.id`, el stack entero está andando: la app rutea a
GoTrue y GoTrue escribe en Postgres. Después entrá por `/login` con ese mail.

Acordate de poner `GOTRUE_DISABLE_SIGNUP=true` cuando termines de dar altas.

---

## Nota sobre el entorno local

`scripts/db-local.sh` **no** levanta GoTrue: crea un `auth.users` mínimo de dos
columnas como stub, que alcanza para los tests de scraping y evita levantar un
contenedor más para correrlos.

Eso significa que **el login no funciona en local** con ese script. Es a
propósito, pero tenelo presente: es la razón por la que el problema del
`search_path` de GoTrue no aparece hasta que armás el stack de verdad.
