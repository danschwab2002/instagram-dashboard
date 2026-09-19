-- Stub minimo de `auth.users` para DESARROLLO Y TESTS.
--
-- NO es Supabase Auth ni GoTrue. Solo satisface las foreign keys de
-- `datasets`, `ai_sessions` e `ig_connections`, y los JOIN de db.ts que
-- resuelven el email del dueño.
--
-- En produccion esta tabla la crea y la mantiene GoTrue: alla se corre
-- `00_auth_prepare.sql`, no este archivo.
--
-- Lo consumen `scripts/db-local.sh` y el flujo de integracion continua.
-- Vive en un archivo unico a proposito: cuando estaba escrito adentro de
-- los dos, se desincronizaban.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE
);
