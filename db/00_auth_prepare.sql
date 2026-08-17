-- 00 — Preparacion del schema `auth` para GoTrue.
--
-- ⚠ ORDEN: este archivo va PRIMERO, antes de arrancar GoTrue y antes de
-- schema.sql. Si se corre despues, las tablas de auth quedan con el dueño
-- equivocado y GoTrue falla con "must be owner of table users".
--
-- Secuencia completa:
--   1. este archivo
--   2. arrancar GoTrue  → crea auth.users y sus tablas
--   3. schema.sql + migrations/ + functions.sql
--
-- La imagen `supabase/postgres` trae todo esto de fabrica. Sobre un `postgres`
-- oficial hay que hacerlo a mano, que es de lo que se ocupa este archivo.

BEGIN;

-- Roles del ecosistema Supabase. `supabase_auth_admin` es el que usa GoTrue;
-- los otros tres aparecen en los GRANT de sus migraciones.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- ⚠ Cambiá esta contraseña y usá la misma en GOTRUE_DB_DATABASE_URL.
ALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD 'CAMBIAME';

-- El detalle que hace fallar todo si falta: GoTrue consulta `users`, no
-- `auth.users`. Sin este search_path tira 'relation "users" does not exist'.
ALTER ROLE supabase_auth_admin SET search_path TO auth, public;

-- El schema tiene que NACER con GoTrue como dueño: sus migraciones alteran y
-- comentan las tablas que ellas mismas crean, y sin ser owner no pueden.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;

GRANT ALL PRIVILEGES ON SCHEMA auth TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;

-- Para que el usuario de la app pueda hacer los JOIN contra auth.users que
-- necesita el dashboard (db.ts resuelve owner_email por ahi).
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth
  GRANT SELECT ON TABLES TO postgres;

COMMIT;
