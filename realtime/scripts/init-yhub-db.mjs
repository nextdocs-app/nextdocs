#!/usr/bin/env node
/**
 * Creates the Yhub database on an existing Postgres volume.
 *
 * `docker/postgres-init.sql` only runs when the volume is first initialised, so a
 * volume created before Yhub existed never gains the database, and the realtime
 * service then fails at its first seed. Compose runs this once per `up` instead;
 * `@y/hub/bin/init-db.js` applies the schema afterwards. Both steps are idempotent.
 */
import { URL } from 'node:url';
import postgres from 'postgres';

const url = process.env.POSTGRES;
if (!url) {
  console.error(
    'POSTGRES must point at the Yhub database, e.g. postgres://user:pass@postgres:5432/nextdocs_yhub'
  );
  process.exit(1);
}

const target = new URL(url);
const database = decodeURIComponent(target.pathname.replace(/^\/+/, ''));
if (!database) {
  // Never echo the URL: it carries the database password.
  console.error('POSTGRES must include the Yhub database name in its path.');
  process.exit(1);
}

// Connect to the maintenance database: CREATE DATABASE cannot run from inside the
// database it creates.
const maintenance = new URL(url);
// Only the path changes: query options such as sslmode still apply to the
// maintenance connection.
maintenance.pathname = '/postgres';

const sql = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
// A session advisory lock serializes concurrent initializers on the same volume: both
// would otherwise read "absent" and race to CREATE DATABASE, and the loser would fail
// the compose `up`. CREATE DATABASE cannot run inside a transaction, so this is a
// session lock held across the check and create, not an xact lock.
const LOCK_KEY = 823451001;
try {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
  const existing = await sql`SELECT 1 FROM pg_database WHERE datname = ${database}`;
  if (existing.length > 0) {
    console.log(`Yhub database "${database}" already exists`);
  } else {
    // The name is an identifier, so it cannot be a bind parameter; quote it.
    const identifier = `"${database.replace(/"/g, '""')}"`;
    await sql.unsafe(`CREATE DATABASE ${identifier}`);
    console.log(`Created Yhub database "${database}"`);
  }
} finally {
  try {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  } catch {
    // The connection is about to close, which releases the lock anyway.
  }
  await sql.end({ timeout: 5 });
}
