-- Yhub stores its document stream in its own database, separate from the API schema.
-- This runs only when the postgres volume is first initialised; an existing volume
-- needs `CREATE DATABASE nextdocs_yhub;` run once as the nextdocs user.
CREATE DATABASE nextdocs_yhub;
