'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, run, runSilent, sleepSync } = require('./proc');

const {
  POSTGRES_CONTAINER,
  POSTGRES_IMAGE,
  POSTGRES_PORT,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  apiDatabase,
  yhubDatabase,
  redisPrefix,
  localYhubPostgresUrl,
  yhubPostgresUrl,
  REDIS_CONTAINER,
  REDIS_IMAGE,
  REDIS_PORT,
} = require('./constants');

/**
 * A freshly started container accepts TCP before Postgres can answer a query, and
 * `docker start` on an existing volume returns immediately. Checking for the databases
 * before that point would read as "absent" and then fail to create them.
 */
function waitForPostgresReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Force TCP: during init Postgres starts a temporary server on the unix socket
    // and then restarts; the socket probe succeeds too early and the next step can
    // still fail on the final server. The admin database always exists.
    const ping = runSilent(
      `docker exec ${POSTGRES_CONTAINER} pg_isready -h 127.0.0.1 -p 5432 -U ${POSTGRES_USER} -d postgres`,
      // Bound each probe by what is left, like the Redis loop: a wedged `docker exec`
      // must not outlast the deadline it is supposed to enforce.
      { timeout: Math.max(1, deadline - Date.now()) }
    );
    if (ping.status === 0) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    sleepSync(500);
  }
}

/** Create one database if it is absent; names come from the instance id, never user input. */
function ensureDatabase(name) {
  const checkDb = runSilent(
    `docker exec ${POSTGRES_CONTAINER} psql -U ${POSTGRES_USER} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${name}'"`
  );
  // A failed query is not "the database is missing": creating on top of a broken
  // connection only hides the real problem until the next step fails.
  if (checkDb.status !== 0) {
    throw new Error(
      `Could not check for the ${name} database. ${(checkDb.stderr || checkDb.stdout || '')
        .toString()
        .trim()}`
    );
  }

  if (checkDb.stdout.toString().trim() === '1') return false;

  console.log(`\x1b[34m> Creating ${name} database...\x1b[0m`);
  const created = runSilent(
    `docker exec ${POSTGRES_CONTAINER} psql -U ${POSTGRES_USER} -d postgres -c "CREATE DATABASE ${name} OWNER ${POSTGRES_USER};"`
  );
  if (created.status !== 0) {
    throw new Error(
      `Could not create the ${name} database. ${(created.stderr || created.stdout || '')
        .toString()
        .trim()}`
    );
  }
  return true;
}

/**
 * Both databases for the current worktree. The API database is created even for a
 * realtime-only session so the two stay in step; the Yhub schema (the DDL Yhub never
 * runs on boot) is only initialized when the realtime service will use it.
 *
 * `local` makes the Yhub initializer ignore an inherited `POSTGRES`: a reset names this
 * worktree's database in its prompt, so that is the one it must initialize.
 */
function ensureDatabases({ yhubSchema = true, local = false } = {}) {
  if (!waitForPostgresReady()) {
    throw new Error(
      `Postgres did not become ready in ${POSTGRES_CONTAINER}; cannot provision the instance databases.`
    );
  }

  ensureDatabase(apiDatabase());
  ensureDatabase(yhubDatabase());

  // Idempotent: an existing database can still be missing the Yhub schema.
  if (yhubSchema) ensureYhubSchema(local);
}

// Yhub never runs DDL on boot; init-db.js is the only supported path and is
// idempotent, so running it here is what makes `./nd dev` work on a fresh volume.
function yhubInitializerPath() {
  // Prefer the initializer from the workspace that declares @y/hub: the root copy
  // can be stale when the dependency graph resolves a different version.
  const initScript = [
    path.join(ROOT, 'realtime', 'node_modules', '@y', 'hub', 'bin', 'init-db.js'),
    path.join(ROOT, 'node_modules', '@y', 'hub', 'bin', 'init-db.js'),
  ].find((candidate) => fs.existsSync(candidate));
  if (!initScript) {
    // Realtime cannot boot without the schema, so skipping it here would only move
    // the failure to the first connection with a less obvious message.
    throw new Error(
      'Cannot initialize the Yhub schema: @y/hub is not installed. ' +
        'Run `pnpm install` from the repo root, then retry.'
    );
  }
  return initScript;
}

function ensureYhubSchema(local = false) {
  const initScript = yhubInitializerPath();
  const result = spawnSync(process.execPath, [initScript], {
    cwd: ROOT,
    stdio: 'pipe',
    env: {
      ...process.env,
      POSTGRES: local ? localYhubPostgresUrl() : yhubPostgresUrl(),
    },
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(`Could not initialize the Yhub schema. ${detail}`);
  }
}

/**
 * Start one shared container, adopting the one another worktree may have created.
 *
 * Two stacks can reach `docker run` together on a cold Docker host. `run` exits on the
 * loser's name conflict, which would abort that worktree even though the winner's
 * container is exactly the one it needs.
 */
function startSharedContainer(command, name) {
  const status = run(command, { exitOnError: false });
  if (status === 0) return;
  const running = runSilent(`docker inspect -f "{{.State.Running}}" ${name}`);
  if (running.status !== 0 || running.stdout.toString().trim() !== 'true') {
    throw new Error(`Could not start ${name} (docker exited ${status ?? 'on a signal'}).`);
  }
  console.log(`\x1b[34m> Another worktree started ${name}; using it.\x1b[0m`);
}

/**
 * What is wrong with the container's published Postgres mapping, as a message, or null
 * when the mapping is the one this CLI provisions and connects to. Pure so the accepted
 * and rejected shapes are covered without a Docker host.
 */
function postgresBindingProblem(bindings) {
  const ports = bindings && bindings['5432/tcp'];
  const observed = Array.isArray(ports)
    ? ports.map((port) => `${port.HostIp || '*'}:${port.HostPort}`).join(', ')
    : '(none)';
  const recreate =
    'Remove and recreate the container with ./nd dev; its nextdocs_pgdata volume will be preserved.';
  if (!Array.isArray(ports) || ports.length === 0) {
    return (
      `${POSTGRES_CONTAINER} publishes no host port (${observed}); it must publish ` +
      `127.0.0.1:${POSTGRES_PORT}. ${recreate}`
    );
  }
  const loopback = (host) => host === '127.0.0.1' || host === '::1';
  if (ports.some((port) => !loopback(port.HostIp))) {
    return `${POSTGRES_CONTAINER} is not bound to loopback only (${observed}). ${recreate}`;
  }
  // Provisioning runs inside the container while the API and Flyway connect to the host
  // port, so a container published on another host port is the wrong server for every
  // command that follows.
  if (ports.some((port) => String(port.HostPort) !== String(POSTGRES_PORT))) {
    return (
      `${POSTGRES_CONTAINER} publishes Postgres on ${observed}, but this CLI expects ` +
      `127.0.0.1:${POSTGRES_PORT}. ${recreate}`
    );
  }
  return null;
}

function assertPostgresLoopback() {
  const bindings = spawnSync(
    'docker',
    ['inspect', '-f', '{{json .HostConfig.PortBindings}}', POSTGRES_CONTAINER],
    {
      encoding: 'utf8',
    }
  );
  if (bindings.status !== 0) return;
  let parsed;
  try {
    parsed = JSON.parse(bindings.stdout);
  } catch {
    throw new Error(`Could not inspect ${POSTGRES_CONTAINER} port bindings.`);
  }
  const problem = postgresBindingProblem(parsed);
  if (problem) throw new Error(problem);
}

function ensurePostgres({ yhubSchema = true, local = false } = {}) {
  assertPostgresLoopback();
  // Check if container is already running
  const check = runSilent(`docker inspect -f "{{.State.Running}}" ${POSTGRES_CONTAINER}`);
  if (check.status === 0 && check.stdout.toString().trim() === 'true') {
    console.log(`\x1b[32m✓ Postgres already running\x1b[0m`);
    ensureDatabases({ yhubSchema, local });
    return;
  }

  // Check if container exists but is stopped
  const exists = runSilent(`docker inspect ${POSTGRES_CONTAINER}`);
  if (exists.status === 0) {
    console.log(`\x1b[34m> Starting existing postgres container...\x1b[0m`);
    run(`docker start ${POSTGRES_CONTAINER}`);
    ensureDatabases({ yhubSchema, local });
    return;
  }

  // Create and start a new container
  console.log(`\x1b[34m> Starting postgres...\x1b[0m`);
  startSharedContainer(
    [
      'docker run -d',
      `--name ${POSTGRES_CONTAINER}`,
      // The dev password is not a secret, so the port belongs on the loopback interface
      // only, the same way Redis is published.
      `-p 127.0.0.1:${POSTGRES_PORT}:5432`,
      `-e POSTGRES_USER=${POSTGRES_USER}`,
      `-e POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      `-e POSTGRES_DB=nextdocs`,
      `-v nextdocs_pgdata:/var/lib/postgresql/data`,
      POSTGRES_IMAGE,
    ].join(' '),
    POSTGRES_CONTAINER
  );
  assertPostgresLoopback();
  ensureDatabases({ yhubSchema, local });
}

/**
 * A restarted Redis replays its append-only file before it answers commands; a dev
 * volume that accumulated Yhub rooms takes seconds to do that. Until then every
 * command fails with `LOADING Redis is loading the dataset in memory`, and the
 * realtime server's first command would kill the process instead of retrying.
 * `docker start` returns long before that point, so wait for PONG here the same
 * way Postgres waits for `pg_isready`.
 */
function waitForRedisReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    // A wedged `docker exec` would otherwise block the loop past the deadline;
    // bound every probe by what is left and count a timeout as a failed attempt.
    const ping = runSilent(`docker exec ${REDIS_CONTAINER} redis-cli ping`, {
      timeout: Math.max(1, deadline - Date.now()),
    });
    if (ping.status === 0 && ping.stdout.toString().trim() === 'PONG') {
      return true;
    }
    if (!announced) {
      console.log(`\x1b[34m> Waiting for Redis to finish loading its dataset...\x1b[0m`);
      announced = true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    sleepSync(250);
  }
}

function ensureRedis() {
  const check = runSilent(`docker inspect -f "{{.State.Running}}" ${REDIS_CONTAINER}`);
  if (check.status === 0 && check.stdout.toString().trim() === 'true') {
    console.log(`\x1b[32m✓ Redis already running\x1b[0m`);
  } else {
    const exists = runSilent(`docker inspect ${REDIS_CONTAINER}`);
    if (exists.status === 0) {
      console.log(`\x1b[34m> Starting existing redis container...\x1b[0m`);
      run(`docker start ${REDIS_CONTAINER}`);
    } else {
      console.log(`\x1b[34m> Starting redis...\x1b[0m`);
      startSharedContainer(
        [
          'docker run -d',
          `--name ${REDIS_CONTAINER}`,
          `-p 127.0.0.1:${REDIS_PORT}:6379`,
          REDIS_IMAGE,
          'redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy volatile-lru',
        ].join(' '),
        REDIS_CONTAINER
      );
    }
  }

  if (!waitForRedisReady()) {
    throw new Error(
      `Redis did not become ready in ${REDIS_CONTAINER} (still loading or unreachable).`
    );
  }
}

// --- Non-interactive inspection used by `./nd db status` and the seed -------------

function containerRunning(container) {
  const result = runSilent(`docker inspect -f "{{.State.Running}}" ${container}`);
  return result.status === 0 && result.stdout.toString().trim() === 'true';
}

/** Run SQL through the container's psql; throws with stderr on failure. */
function psql(database, sql, { tuplesOnly = true, timeout } = {}) {
  const flags = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  if (tuplesOnly) flags.push('-tA');
  const result = runSilent(
    `docker exec -i ${POSTGRES_CONTAINER} psql -U ${POSTGRES_USER} -d ${database} ${flags.join(' ')} -f -`,
    { input: sql, timeout }
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(`psql failed on ${database}: ${detail}`);
  }
  return result.stdout.toString();
}

function queryValue(database, sql) {
  const output = psql(database, sql).trim();
  return output ? output.split('\n')[0] : '';
}

/** Database names are instance-derived and always exist for this query. */
function databaseExists(database) {
  return queryValue('postgres', `SELECT 1 FROM pg_database WHERE datname = '${database}'`) === '1';
}

function tableExists(database, table) {
  return queryValue(database, `SELECT to_regclass('public.${table}') IS NOT NULL`) === 't';
}

function redisPing() {
  const result = runSilent(`docker exec ${REDIS_CONTAINER} redis-cli ping`, { timeout: 3000 });
  return result.status === 0 && result.stdout.toString().trim() === 'PONG';
}

/**
 * Delete this worktree's Yhub keys only. A `FLUSHDB` here would wipe the live streams
 * of every other running instance that shares the Redis container.
 *
 * The scan runs as one bounded step per Redis call, driven from here: a Lua loop over the
 * whole keyspace would block every other worktree's Redis commands until it finished.
 * Keys never leave Redis, so binary keys cannot be split or interpreted by a shell.
 */
function redisFlushPrefix(prefix = redisPrefix()) {
  if (typeof prefix !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(prefix)) {
    throw new Error(`Refusing to flush an unexpected Redis prefix '${prefix}'.`);
  }
  return flushPrefixInSteps(`${prefix}:*`, (cursor) => runRedisScanStep(prefix, cursor));
}

function runRedisScanStep(prefix, cursor) {
  const step = [
    "local result = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', 200)",
    'local removed = 0',
    "for _, key in ipairs(result[2]) do removed = removed + redis.call('DEL', key) end",
    "return result[1] .. ' ' .. removed",
  ].join('\n');
  const result = spawnSync(
    'docker',
    ['exec', REDIS_CONTAINER, 'redis-cli', 'EVAL', step, '0', String(cursor), `${prefix}:*`],
    { encoding: 'utf8', timeout: 10_000 }
  );
  const output = (result.stdout || '').trim();
  const match = /^(\d+)\s+(\d+)$/.exec(output);
  if (result.status !== 0 || !match) {
    throw new Error(
      `Could not clear Redis prefix '${prefix}': ` +
        `${(result.stderr || result.stdout || result.error?.message || '').trim()}`
    );
  }
  return { cursor: match[1], removed: Number(match[2]) };
}

/**
 * Drive a `SCAN`-based flush cursor to completion, one bounded batch per call. The loop
 * is client-side on purpose; `step` is injectable so the batching is testable without a
 * Redis server.
 */
function flushPrefixInSteps(pattern, step, { maxSteps = 100_000 } = {}) {
  let cursor = '0';
  let removed = 0;
  let steps = 0;
  do {
    steps += 1;
    if (steps > maxSteps) {
      throw new Error(`Gave up clearing '${pattern}' after ${maxSteps} scan steps.`);
    }
    const batch = step(cursor);
    removed += Number(batch.removed) || 0;
    cursor = String(batch.cursor);
  } while (cursor !== '0');
  return removed;
}

/** Drop one database and its connections; used by `db reset` and `db prune`. */
function dropDatabase(name) {
  psql(
    'postgres',
    [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity`,
      ` WHERE datname = '${name}' AND pid <> pg_backend_pid();`,
      // FORCE (PG 13+) closes the gap between terminating backends and the drop: a
      // client that reconnects in between would otherwise fail the drop.
      `DROP DATABASE IF EXISTS ${name} WITH (FORCE);`,
    ].join('\n')
  );
}

module.exports = {
  waitForPostgresReady,
  ensureDatabase,
  ensureDatabases,
  ensurePostgres,
  startSharedContainer,
  waitForRedisReady,
  ensureRedis,
  yhubInitializerPath,
  postgresBindingProblem,
  containerRunning,
  psql,
  queryValue,
  databaseExists,
  tableExists,
  redisPing,
  redisFlushPrefix,
  flushPrefixInSteps,
  dropDatabase,
};
