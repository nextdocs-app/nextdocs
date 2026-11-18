'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, runSilent } = require('./proc');
const {
  POSTGRES_CONTAINER,
  POSTGRES_PORT,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  apiDatabase,
  localPostgresUrl,
  postgresUrl,
} = require('./constants');
const { psql, tableExists } = require('./containers');

const MIGRATION_DIR = path.join(ROOT, 'api', 'src', 'main', 'resources', 'db', 'migration');
const isWin = process.platform === 'win32';
// Relative to the API cwd: an absolute Windows path can contain spaces, which would
// break the shell command used to launch the .cmd wrapper.
const mvnw = isWin ? 'mvnw.cmd' : './mvnw';

/**
 * Flyway's own CLI reads credentials from FLYWAY_* environment variables. Passing them
 * as `-D` arguments would put the password in the process list, which is exactly what
 * this wrapper exists to avoid.
 */
function flywayEnv({ clean = false, local = false } = {}) {
  const env = {
    ...process.env,
    FLYWAY_URL: flywayUrl({ local }),
    // `local` pins the credentials to the container as well: a reset must not connect
    // to the inherited URL's database with the inherited URL's user.
    FLYWAY_USER: local
      ? POSTGRES_USER
      : process.env.SPRING_DATASOURCE_USERNAME || process.env.FLYWAY_USER || POSTGRES_USER,
    FLYWAY_PASSWORD: local
      ? POSTGRES_PASSWORD
      : process.env.SPRING_DATASOURCE_PASSWORD || process.env.FLYWAY_PASSWORD || POSTGRES_PASSWORD,
    // An absolute filesystem location reads the same sources the app packages and works
    // without compiling the project first.
    // Flyway's filesystem location uses forward slashes on every platform.
    FLYWAY_LOCATIONS: `filesystem:${MIGRATION_DIR.replace(/\\/g, '/')}`,
  };
  // Pin the guard both ways: only the explicit clean/reset path lifts it, so an exported
  // FLYWAY_CLEAN_DISABLED=false cannot widen what the wrapper runs.
  env.FLYWAY_CLEAN_DISABLED = clean ? 'false' : 'true';
  return env;
}

/**
 * Flyway's JDBC URL. `local` ignores `SPRING_DATASOURCE_URL`, for the commands that name
 * this worktree's database in their prompt and must not target an inherited one.
 * A libpq URL without a port means 5432 (the client default), not the dev container's
 * 5433, and its query string (`sslmode`, for a remote URL) has to survive the rewrite.
 */
function flywayUrl({ local = false } = {}) {
  const configured = local ? null : process.env.SPRING_DATASOURCE_URL;
  if (configured && configured.startsWith('jdbc:')) return configured;

  const raw = local ? localPostgresUrl() : configured || postgresUrl();
  const parsed = /^postgres(?:ql)?:\/\/(?:[^@/]*@)?([^/:?]+)(?::(\d+))?\/([^?]+)(\?\S*)?$/i.exec(
    raw
  );
  if (!parsed && configured) {
    // A libpq URL without a path is valid (the database defaults to the user name), but
    // substituting the dev container's database would let `db info`/`validate`/`repair`
    // act on a target the caller never named. The value is never echoed: it can carry
    // a password.
    throw new Error(
      'SPRING_DATASOURCE_URL is not a supported Postgres URL: use a jdbc:postgresql:// ' +
        'URL, or a postgres:// URL that names a database.'
    );
  }
  const host = parsed ? parsed[1] : 'localhost';
  // No URL at all means the local container, which listens on 5433; a parsed URL with no
  // port means whatever libpq would have used against that host.
  const port = parsed ? parsed[2] || '5432' : POSTGRES_PORT;
  const database = parsed ? parsed[3] : apiDatabase();
  const query = (parsed && parsed[4]) || '';
  return `jdbc:postgresql://${host}:${port}/${database}${query}`;
}

/** `mvnw -q flyway:<goal>`; credentials never appear in the printed command. */
function runFlyway(goal, { clean = false, quiet = false, local = false } = {}) {
  const args = [];
  if (quiet) args.push('-q');
  args.push(`flyway:${goal}`, '--no-transfer-progress');
  // `mvnw` is the relative wrapper the API is launched through; the same string is
  // printed so the log matches the invocation.
  const command = `${mvnw} ${args.join(' ')}`;
  console.log(`\x1b[34m> (api) ${command}\x1b[0m`);
  const result = spawnSync(mvnw, args, {
    cwd: path.join(ROOT, 'api'),
    stdio: 'inherit',
    env: flywayEnv({ clean, local }),
    // .cmd wrappers must be launched through cmd.exe; POSIX keeps an argument array.
    shell: isWin,
  });
  return result.status === null ? 1 : result.status;
}

/** Migration files on disk, numeric order, as Flyway would apply them. */
function migrationFiles() {
  return fs
    .readdirSync(MIGRATION_DIR)
    .map((file) => {
      const match = /^V(\d+)__(.+)\.sql$/.exec(file);
      return match
        ? { version: Number(match[1]), description: match[2].replace(/_/g, ' '), file }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

/**
 * Applied/pending/failed as the database sees them. Reads the history table directly so
 * `db status` stays fast and works while the API is stopped; `db info` is the Flyway
 * rendering for checksum detail.
 */
function migrationState(database = apiDatabase()) {
  const files = migrationFiles();
  const result = {
    total: files.length,
    latest: files.length ? files[files.length - 1].version : 0,
    applied: 0,
    pending: files.length,
    failed: 0,
    installed: false,
  };
  if (!tableExists(database, 'flyway_schema_history')) {
    return result;
  }
  result.installed = true;
  const rows = psql(
    database,
    'SELECT version, success FROM flyway_schema_history WHERE version IS NOT NULL'
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [version, success] = line.split('|');
      return { version: Number(version), success: success === 't' };
    });
  const applied = new Set(rows.filter((row) => row.success).map((row) => row.version));
  result.applied = applied.size;
  result.failed = rows.filter((row) => !row.success).length;
  result.pending = files.filter((file) => !applied.has(file.version)).length;
  return result;
}

/** The container is the only supported local server for these commands. */
function requireLocalPostgres() {
  const status = runSilent(`docker inspect -f "{{.State.Running}}" ${POSTGRES_CONTAINER}`);
  if (status.status !== 0 || status.stdout.toString().trim() !== 'true') {
    throw new Error(
      `Postgres container '${POSTGRES_CONTAINER}' is not running. Run \`./nd dev\` first, then retry.`
    );
  }
}

module.exports = {
  MIGRATION_DIR,
  flywayEnv,
  flywayUrl,
  runFlyway,
  migrationFiles,
  migrationState,
  requireLocalPostgres,
};
