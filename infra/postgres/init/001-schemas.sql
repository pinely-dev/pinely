-- Schemas are separated from the start:
--   app    : owned by the backend (Drizzle)
--   ponder : owned by the Ponder indexer
-- This script only runs while the PostgreSQL volume is still empty.
-- On Railway, run the same SQL once by hand before the first deploy.

create schema if not exists app;
create schema if not exists ponder;

comment on schema app is 'PINELY backend - managed by Drizzle';
comment on schema ponder is 'PINELY indexer - managed by Ponder, read-only for the backend';

-- Do not let new objects be created in public by accident.
revoke create on schema public from public;
