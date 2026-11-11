-- Yhub stores its document stream in its own database, separate from the API schema.
-- This runs only when the postgres volume is first initialised; an existing volume
-- is provisioned by the one-shot `yhub-init` service instead.
--
-- `POSTGRES_DB` already created the API database, but a volume can also be
-- initialised by an image whose entrypoint already created `nextdocs_yhub`; create
-- only when it is absent. psql's \gexec runs the statement outside a transaction,
-- which CREATE DATABASE requires.
SELECT 'CREATE DATABASE nextdocs_yhub'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nextdocs_yhub')\gexec
