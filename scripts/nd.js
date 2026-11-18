#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, run, runSilent, sleep, redirectRunStdout } = require('./lib/proc');
const {
  POSTGRES_CONTAINER,
  POSTGRES_PORT,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  REDIS_CONTAINER,
  REDIS_PORT,
  MAILPIT_CONTAINER,
  MAILPIT_IMAGE,
  MAILPIT_SMTP_PORT,
  MAILPIT_WEB_PORT,
  isKeyEmptyOrPlaceholder,
  attachmentStoragePath,
  setInstance,
} = require('./lib/constants');
const {
  ensurePostgres,
  ensureRedis,
  startSharedContainer,
  containerRunning,
  redisPing,
} = require('./lib/containers');
const {
  isPidAlive,
  isWorktreePresent,
  listRecords,
  liveServicePids,
  liveSupervisors,
  claimedServices,
  peekInstance,
  resolveInstance,
  claimInstance,
  instanceClaimOwner,
  releaseInstanceClaim,
  recordIsRunning,
  clearServicePids,
  setServicePids,
  setSupervisor,
  clearSupervisor,
  servicesOf,
  readRecord,
} = require('./lib/instance');
const { describeOwner } = require('./lib/lock');
const { portOpen } = require('./lib/ports');
const { beginLog, logFile, tailFile, tailSession } = require('./lib/logs');
const { findForbiddenLockfiles } = require('./lib/lockfiles');

// --- Arguments -------------------------------------------------------------------

const rawArgs = process.argv.slice(2);
let isFix = false;
let newPorts = false;
let detached = false;
let wantJson = false;
let portOffset = null;
const args = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg === '--fix') {
    isFix = true;
  } else if (arg === '--new-ports') {
    newPorts = true;
  } else if (arg === '--detach') {
    detached = true;
  } else if (arg === '--json') {
    wantJson = true;
  } else if (arg === '--port-offset') {
    portOffset = rawArgs[index + 1];
    if (portOffset == null || portOffset.startsWith('-')) {
      console.error('--port-offset requires a number, e.g. --port-offset 100.');
      process.exit(1);
    }
    index += 1;
  } else if (arg.startsWith('--port-offset=')) {
    portOffset = arg.slice('--port-offset='.length);
  } else {
    args.push(arg);
  }
}

const command = args[0];
const service = args[1];

const isWin = process.platform === 'win32';
const ALL_SERVICES = ['api', 'web', 'realtime'];
const JSON_COMMANDS = new Set(['up', 'status', 'urls', 'logs', 'stop', 'down', 'dev']);
const ROOT_PACKAGE = require(path.join(ROOT, 'package.json'));

const REQUIRED_JS_BINARIES = [
  path.join(ROOT, 'node_modules', '.bin', isWin ? 'turbo.cmd' : 'turbo'),
];

const REQUIRED_WORKSPACE_PACKAGES = {
  web: ['next', 'react', 'react-dom'],
  realtime: ['tsx', '@y/hub'],
};

const mvnw = isWin ? 'mvnw.cmd' : './mvnw';

// TODO: If the number of keys that need to be generated this way are more,
// we may need to find a more generalizable pattern.
let generatedDevOAuthTokenKey = null;
let generatedDevJwtSecret = null;
let generatedDevYhubServiceToken = null;

function getOrCreateDevOAuthTokenEncryptionKey() {
  if (!generatedDevOAuthTokenKey) {
    generatedDevOAuthTokenKey = randomBytes(32).toString('base64');
  }
  return generatedDevOAuthTokenKey;
}

function getOrCreateDevJwtSecret() {
  if (!generatedDevJwtSecret) {
    generatedDevJwtSecret = randomBytes(32).toString('base64');
  }
  return generatedDevJwtSecret;
}

// The API rejects the published development token at startup. One session-wide
// value is shared by the API and realtime children, like the generated JWT secret.
function getOrCreateDevYhubServiceToken() {
  if (!generatedDevYhubServiceToken) {
    generatedDevYhubServiceToken = randomBytes(32).toString('base64url');
  }
  return generatedDevYhubServiceToken;
}

// --- Per-instance service environment --------------------------------------------

/**
 * The API's links point at this worktree's stack: invite emails, the browser's
 * websocket URL and CORS all have to name its ports, otherwise a browser opened in
 * one worktree would read and join another worktree's rooms.
 */
function buildApiDevEnv(instance, overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
  };

  // Keep required API dev env defaults in one place so ./nd dev is zero-setup.
  if (isKeyEmptyOrPlaceholder(env.OAUTH_TOKEN_ENCRYPTION_KEY_BASE64)) {
    env.OAUTH_TOKEN_ENCRYPTION_KEY_BASE64 = getOrCreateDevOAuthTokenEncryptionKey();
    console.warn(
      '\x1b[33mWARNING: OAUTH_TOKEN_ENCRYPTION_KEY_BASE64 was not set. Using an ephemeral dev key for this ./nd session.\n' +
        '  Set OAUTH_TOKEN_ENCRYPTION_KEY_BASE64 for stable token decryption across restarts.\x1b[0m'
    );
  }

  if (isKeyEmptyOrPlaceholder(env.JWT_SECRET)) {
    env.JWT_SECRET = getOrCreateDevJwtSecret();
    console.warn(
      '\x1b[33mWARNING: JWT_SECRET was not set. Using an ephemeral dev key for this ./nd session.\n' +
        '  Set JWT_SECRET for stable token validation across restarts.\x1b[0m'
    );
  }

  {
    // Same-instance web origin first, then the LAN wildcards that make phone testing
    // work. The port comes from the allocation, not a fixed 3000. A value from the
    // shell is appended rather than replaced, so a tunnel origin keeps working.
    const webPort = instance.ports.web;
    const instanceOrigins = [
      `http://localhost:${webPort}`,
      `http://127.0.0.1:${webPort}`,
      `http://192.168.*.*:${webPort}`,
      `http://10.*.*.*:${webPort}`,
      ...Array.from({ length: 16 }, (_, i) => `http://172.${i + 16}.*.*:${webPort}`),
    ];
    env.CORS_ALLOWED_ORIGINS = [instanceOrigins.join(','), (env.CORS_ALLOWED_ORIGINS || '').trim()]
      .filter(Boolean)
      .join(',');
  }

  if (isKeyEmptyOrPlaceholder(env.SPRING_MAIL_HOST)) {
    env.SPRING_MAIL_HOST = 'localhost';
    env.SPRING_MAIL_PORT = MAILPIT_SMTP_PORT;
    env.SPRING_MAIL_SMTP_STARTTLS = 'false';
    env.SPRING_MAIL_SMTP_SSL_CHECK_SERVER_IDENTITY = 'false';
  }

  if (isKeyEmptyOrPlaceholder(env.YHUB_SERVICE_TOKEN)) {
    env.YHUB_SERVICE_TOKEN = getOrCreateDevYhubServiceToken();
    console.warn(
      '\x1b[33mWARNING: YHUB_SERVICE_TOKEN was not set. Using an ephemeral dev token for this ./nd session.\n' +
        '  Set YHUB_SERVICE_TOKEN to run the API and realtime service as separate sessions.\x1b[0m'
    );
  }

  // Identity values are owned by the instance record, not by whatever the shell
  // exported: a stray SPRING_DATASOURCE_URL/PORT/YHUB_* from another stack would
  // otherwise silently point this worktree at the wrong database or rooms. Use
  // --new-ports/--port-offset/ND_*_PORT to choose different values.
  env.SERVER_PORT = String(instance.ports.api);
  env.SPRING_DATASOURCE_URL = `jdbc:postgresql://localhost:${POSTGRES_PORT}/${instance.database}`;
  env.APP_WEB_BASE_URL = `http://localhost:${instance.ports.web}`;
  env.YHUB_BASE_URL = `http://localhost:${instance.ports.realtime}`;
  env.YHUB_WS_URL = `ws://localhost:${instance.ports.realtime}/api/ws/v1/nextdocs`;

  return env;
}

function buildRealtimeDevEnv(instance, overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
  };

  if (isKeyEmptyOrPlaceholder(env.JWT_SECRET)) {
    env.JWT_SECRET = getOrCreateDevJwtSecret();
  }

  if (isKeyEmptyOrPlaceholder(env.YHUB_SERVICE_TOKEN)) {
    env.YHUB_SERVICE_TOKEN = getOrCreateDevYhubServiceToken();
  }

  env.REDIS = `redis://localhost:${REDIS_PORT}`;

  // Identity values are owned by the instance record; see buildApiDevEnv.
  env.PORT = String(instance.ports.realtime);
  env.POSTGRES = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${instance.yhubDatabase}`;
  env.API_BASE_URL = `http://localhost:${instance.ports.api}`;
  // Every worktree shares one Redis; the prefix is what keeps its rooms and streams
  // from colliding with another worktree's copy of the same seeded document ids.
  env.REDIS_PREFIX = instance.redisPrefix;
  env.CORS_ORIGIN = [
    `http://localhost:${instance.ports.web}`,
    `http://127.0.0.1:${instance.ports.web}`,
    (env.CORS_ORIGIN || '').trim(),
  ]
    .filter(Boolean)
    .join(',');

  return env;
}

/**
 * The browser keeps deriving the API/realtime host from the page (so phone testing on
 * a LAN IP still works), while the ports come from this worktree's allocation.
 */
/** The web launcher suppresses full-URL overrides when ND_WEB_PORT is set. */
function buildWebDevEnv(instance, overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
    ND_WEB_PORT: String(instance.ports.web),
    NEXT_PUBLIC_API_PORT: String(instance.ports.api),
    NEXT_PUBLIC_REALTIME_PORT: String(instance.ports.realtime),
  };
  return env;
}

function servicesForDev() {
  if (!service) return ALL_SERVICES;
  validateService(service);
  return [service];
}

/**
 * Take this worktree's lifecycle slot before provisioning or spawning anything. `db
 * reset` holds the same slot, so a reset can never run between this check and the
 * services that depend on the databases it would drop.
 */
async function claimLifecycle(instance, command, waitMs = 120_000) {
  const claim = await claimInstance(instance, {
    waitMs,
    label: command,
    onWait: (holder) => {
      console.error(
        `\x1b[34m> Waiting for ${describeOwner(holder)} to release instance '${instance.id}'...\x1b[0m`
      );
    },
  });
  if (!claim) {
    throw new Error(
      `Instance '${instance.id}' is still held by ${describeOwner(instanceClaimOwner(instance))} ` +
        '(a reset or another start). Retry when it finishes.'
    );
  }
  return claim;
}

/**
 * Re-read the instance record under a held claim. The snapshot from before the claim can
 * describe a stack that another terminal has started in the meantime.
 */
function refreshRecord(instance) {
  const record = readRecord(instance.registry, instance.id);
  if (!record) return instance;
  return {
    ...instance,
    ...record,
    running: liveSupervisors(record).length > 0,
  };
}

// --- Instance files and banners --------------------------------------------------

function envFilePath() {
  return path.join(ROOT, '.nd', 'instance.env');
}

function renderInstanceEnv(instance) {
  // The instance record, not NEXTDOCS_*_URL from the shell: this file is the worktree's
  // source of truth for e2e/agents, and it exports those variables itself.
  const { web, api, realtime } = instanceUrls(instance);
  return (
    [
      `# NextDocs instance '${instance.id}' — ${instance.worktree}`,
      '# Generated by ./nd dev. Source it to point e2e/curl at this worktree.',
      `export ND_INSTANCE='${instance.id}'`,
      `# Ports: web ${instance.ports.web}, api ${instance.ports.api}, realtime ${instance.ports.realtime}.`,
      `# Not exported as ND_*_PORT: sourcing another worktree's file would pin them here.`,
      `export NEXTDOCS_WEB_URL='${web}'`,
      `export NEXTDOCS_API_URL='${api}'`,
      `export NEXTDOCS_REALTIME_URL='${realtime}'`,
      `export E2E_WEB_URL='${web}'`,
      `export E2E_API_URL='${api}'`,
      `export E2E_REALTIME_URL='${realtime}'`,
      `export SPRING_DATASOURCE_URL='jdbc:postgresql://localhost:${POSTGRES_PORT}/${instance.database}'`,
      `export POSTGRES='postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${instance.yhubDatabase}'`,
      `export REDIS='redis://localhost:${REDIS_PORT}'`,
      `export REDIS_PREFIX='${instance.redisPrefix}'`,
    ].join('\n') + '\n'
  );
}

function writeInstanceEnvFile(instance) {
  const file = envFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderInstanceEnv(instance));
  return file;
}

function printBanner(instance, heading = 'dev') {
  const urls = instanceUrls(instance);
  console.log('');
  console.log(`\x1b[36m▸ NextDocs ${heading} — instance '${instance.id}'\x1b[0m`);
  console.log(`  web        ${urls.web}`);
  console.log(`  api        ${urls.api}`);
  console.log(`  realtime   ${urls.realtime}`);
  console.log(
    `  postgres   localhost:${POSTGRES_PORT} · ${instance.database} + ${instance.yhubDatabase}`
  );
  console.log(`  redis      localhost:${REDIS_PORT} · prefix '${instance.redisPrefix}'`);
  console.log(`  mailpit    http://localhost:${MAILPIT_WEB_PORT}`);
  console.log(`  env file   ${path.relative(ROOT, envFilePath())} (source it for e2e/agents)`);
  console.log('');
}

function printReadyBanner(instance) {
  const urls = instanceUrls(instance);
  console.log('');
  console.log(`\x1b[32m✓ NextDocs '${instance.id}' is ready\x1b[0m`);
  console.log(`  web      ${urls.web}`);
  console.log(`  api      ${urls.api}`);
  console.log(`  realtime ${urls.realtime}`);
  console.log('');
}

function applyTerminalTitle(instance) {
  if (!process.stdout.isTTY || process.env.ND_NO_TITLE === '1') return;
  process.stdout.write(`\x1b]0;nextdocs[${instance.id}] :${instance.ports.web}\x07`);
}

function resetTerminalTitle() {
  if (!process.stdout.isTTY || process.env.ND_NO_TITLE === '1') return;
  process.stdout.write('\x1b]0;\x07');
}

// --- Dev supervision -------------------------------------------------------------

/**
 * `./nd dev` starts Maven and Turbo through a shell, and both spawn their own
 * children. Signalling only the shell leaves the API (and sometimes Next) running
 * after the CLI exits. Spawn each tree in its own process group and signal the group.
 */
function stopDevChild(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return;
  if (isWin) {
    runSilent(`taskkill /pid ${child.pid} /T /F`);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (_) {
    try {
      child.kill(signal);
    } catch (_) {}
  }
}

function spawnDev(commandLine, commandArgs, options) {
  return spawn(commandLine, commandArgs, {
    stdio: ['inherit', 'pipe', 'pipe'],
    // Windows resolves mvnw.cmd/pnpm.cmd through a shell. POSIX commands are
    // executables with shebangs, and spawning them directly avoids Node's
    // DEP0190 warning about passing an argument list through `shell: true`.
    shell: isWin,
    detached: !isWin,
    ...options,
  });
}

function startApi(instance) {
  return spawnDev(mvnw, ['spring-boot:run', '--no-transfer-progress'], {
    cwd: path.join(ROOT, 'api'),
    env: {
      ...buildApiDevEnv(instance),
      SPRING_OUTPUT_ANSI_ENABLED: 'ALWAYS',
    },
  });
}

function startTurbo(instance, services) {
  const jsServices = services.filter((name) => name !== 'api');
  const filters = jsServices.length === 1 ? ['--filter', jsServices[0]] : [];
  let env = { ...process.env, FORCE_COLOR: '1' };
  if (jsServices.includes('realtime')) env = buildRealtimeDevEnv(instance, env);
  if (jsServices.includes('web')) env = buildWebDevEnv(instance, env);

  return spawnDev('pnpm', ['exec', 'turbo', 'run', 'dev', ...filters], {
    cwd: ROOT,
    env,
  });
}

/**
 * One health probe per service, all in parallel. Web treats any status below 500 as
 * "answering": Next can return 404/401 for a page while it compiles, and the caller
 * only needs to know the server is up.
 */
async function probeHealth(instance, timeoutMs = 2000) {
  const urls = instanceUrls(instance);
  const checks = [
    ['web', urls.web, (res) => res.status < 500],
    ['api', `${urls.api}/api/v1/instance/status`, (res) => res.ok],
    // Readiness, not liveness: `up` promises a stack that can open documents, and
    // /api/ping/v1 answers without touching Postgres or Redis by design.
    ['realtime', `${urls.realtime}/api/health/v1`, (res) => res.ok],
  ];

  const entries = await Promise.all(
    checks.map(async ([name, url, isHealthy]) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return [name, isHealthy(res)];
      } catch {
        return [name, false];
      }
    })
  );
  return Object.fromEntries(entries);
}

async function waitForServices(instance, services, timeoutMs = 180_000) {
  // The instance record, not the shell's NEXTDOCS_*_URL, decides what this run is
  // waiting for: a sourced env file from another worktree must not pass readiness.
  const targets = ALL_SERVICES.filter((name) => services.includes(name));
  const deadline = Date.now() + timeoutMs;
  let health = await probeHealth(instance, 3000);

  for (;;) {
    // Every round is judged on its own answers. Carrying an earlier pass forward would
    // let `up --json` exit 0 while the same document reports `healthy.web: false`.
    const pending = targets.filter((name) => !health[name]);
    if (pending.length === 0) return { ready: true, pending: [], health };
    if (Date.now() >= deadline) return { ready: false, pending, health };
    await sleep(1000);
    health = await probeHealth(instance, 3000);
  }
}

function superviseDev(instance, children, services) {
  let finalCode = 0;
  let closed = 0;

  for (const child of children) {
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    // `close` waits for the output pipes as well as the process; `stdout.end` alone can
    // be reported while the child's exit status is still on its way.
    child.on('close', (code) => {
      if (code !== 0 && code !== null) finalCode = code;
      closed += 1;
      if (closed === children.length) process.exit(finalCode);
    });
  }

  const stopAll = (signal) => {
    for (const child of children) stopDevChild(child, signal);
  };

  const onSignal = (signal) => {
    stopAll(signal);
    process.exit(0);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  // Ports stay in the instance record (they are the sticky allocation), but the
  // supervisor slot is released and the containers are left running for other
  // worktrees. `./nd down` is the explicit teardown.
  process.on('exit', () => {
    stopAll('SIGTERM');
    clearSupervisor(instance);
    resetTerminalTitle();
  });

  void waitForServices(instance, services).then(({ ready, pending }) => {
    if (ready) {
      printReadyBanner(instance);
    } else {
      console.log(
        `\x1b[33m… still waiting on: ${pending.join(', ')}. Check the logs above; ./nd status shows what answers.\x1b[0m`
      );
    }
  });
}

async function assertPortsAvailable(instance, requested) {
  // A second `./nd dev <service>` in this worktree legitimately finds the first one's
  // ports occupied, so what matters is not that a port answers but that the service
  // being asked for is already supervised here.
  if (instance.running) {
    const running = claimedServices(instance);
    const supervisors = liveSupervisors(instance)
      .map((entry) => `${entry.pid} (${servicesOf(entry).join(', ')})`)
      .join('; ');
    const clash = requested.filter((name) => running.includes(name));
    if (clash.length === 0) {
      console.log(
        `\x1b[34m> Instance '${instance.id}' is already running ${running.join(', ')} ` +
          `(pid ${supervisors}); starting ${requested.join(', ')} alongside it.\x1b[0m`
      );
      return;
    }

    const free = ALL_SERVICES.filter((name) => !running.includes(name));
    throw new Error(
      `Instance '${instance.id}' is already running ${running.join(', ')} in the foreground ` +
        `(pid ${supervisors}), and ${clash.join(', ')} is part of it. ` +
        'Starting it again would bind the same port twice: use `./nd logs` to inspect the ' +
        'running stack, or `./nd stop` first.' +
        (free.length > 0 ? ` Only ${free.join(', ')} can still be started here.` : '')
    );
  }

  const live = liveServicePids(instance);
  if (Object.keys(live).length > 0) {
    const details = Object.entries(live)
      .map(([name, pid]) => `${name} pid ${pid}`)
      .join(', ');
    throw new Error(
      `Instance '${instance.id}' is already running detached (${details}). ` +
        'Use `./nd logs` to inspect it or `./nd stop` before starting in the foreground.'
    );
  }

  const busy = [];
  for (const name of ['web', 'api', 'realtime']) {
    if (await portOpen(instance.ports[name])) busy.push(`${name} :${instance.ports[name]}`);
  }
  if (busy.length === 0) return;

  throw new Error(
    `Port(s) already in use for this worktree: ${busy.join(', ')}. ` +
      'Another `./nd dev` (or a leftover process) holds them: `./nd status` shows what ' +
      'answers, `./nd stop` clears this worktree, and `./nd dev --new-ports` re-rolls a ' +
      'saved allocation that went stale.'
  );
}

async function devCommand() {
  if (detached) {
    if (service) {
      throw new Error(
        '--detach starts the full stack. Run `./nd up`, or run one service in the foreground.'
      );
    }
    process.exit(await upCommand());
  }

  const instance = await resolveInstance({
    newPorts,
    portOffset,
    // Persisted so `seed` can refuse a shell whose attachment path differs from the
    // one the running API was started with.
    attachmentStorage: attachmentStoragePath(),
  });
  setInstance(instance);
  const services = servicesForDev();

  const claim = await claimLifecycle(instance, 'dev');
  // A start that finished while this one waited for the claim is only visible in the
  // record, and it may own the very service this run was asked to start.
  const current = refreshRecord(instance);
  let failure = null;
  try {
    await assertPortsAvailable(current, services);
    clearServicePids(instance);

    const needsPostgres = services.some((name) => name === 'api' || name === 'realtime');
    const needsRedis = services.includes('realtime');

    // Fail before touching containers: a fresh worktree without `pnpm install` should
    // get the command to run, not spend time starting infrastructure it cannot use.
    if (service !== 'api') ensureJsWorkspaceReady(service || 'all');
    if (needsPostgres || devUsesLocalMailpit(service)) preflightDocker();

    // Only a realtime run needs the Yhub schema; API/web-only sessions should not
    // fail just because @y/hub is missing. These helpers throw instead of exiting so
    // `db`/`reset` can report their own failure; dev prints the one-line reason here.
    if (needsPostgres) {
      // `local`: an inherited POSTGRES names another worktree's Yhub database, while the
      // realtime child always opens this one.
      ensurePostgres({ yhubSchema: needsRedis, local: true });
    }
    if (needsRedis) ensureRedis();
    if (devUsesLocalMailpit(service)) ensureMailpit();

    // Claimed before the children bind: a reset that arrives later sees this process in
    // the record and refuses, even during the cold start before the first answer.
    writeInstanceEnvFile(instance);
    // Records this terminal's supervisor entry under the registry lock; throwing here
    // fails the start before any child is spawned, so nothing runs unrecorded.
    setSupervisor(instance, process.pid, services);
  } catch (err) {
    // Collected rather than printed: `process.exit` inside the try would skip the
    // release below and leave the worktree claimed.
    failure = err;
  } finally {
    releaseInstanceClaim(claim);
  }
  if (failure) {
    console.error(`\x1b[31m✗ ${failure.message}\x1b[0m`);
    process.exit(1);
  }

  applyTerminalTitle(instance);
  printBanner(instance);

  const children = [];
  if (services.includes('api')) children.push(startApi(instance));
  if (services.some((name) => name !== 'api')) children.push(startTurbo(instance, services));

  superviseDev(instance, children, services);
}

// --- Detached lifecycle ----------------------------------------------------------

function readinessTimeout() {
  const raw = process.env.ND_READY_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === '') return 180_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1000) {
    throw new Error(`ND_READY_TIMEOUT_MS must be an integer >= 1000, received "${raw}".`);
  }
  return value;
}

function plainLogEnv(env) {
  const next = { ...env, NO_COLOR: '1' };
  delete next.FORCE_COLOR;
  return next;
}

function spawnDetachedService(instance, name, commandLine, commandArgs, options) {
  const log = beginLog(name, instance);
  let child;
  try {
    child = spawn(commandLine, commandArgs, {
      cwd: options.cwd,
      env: { ...options.env, ND_INSTANCE: instance.id },
      stdio: ['ignore', log.fd, log.fd],
      // Only Windows needs a shell for .cmd shims. Keeping POSIX direct also avoids
      // Node's DEP0190 warning for an argument list with `shell: true`.
      shell: isWin,
      // Windows needs a new process group too (`detached`), but without a visible
      // console window. The facade stops it with taskkill /T, which follows the tree.
      detached: true,
      windowsHide: isWin,
    });
  } finally {
    fs.closeSync(log.fd);
  }

  // Spawn failures arrive asynchronously, including when no PID was assigned.
  const spawned = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (err) => {
      reject(
        new Error(`Could not start ${name}: ${err.message}; see ${path.relative(ROOT, log.file)}.`)
      );
    });
  });
  // Marked handled here so a sync failure of a later service does not surface as an
  // unhandled rejection; awaiting it still rejects.
  spawned.catch(() => {});
  child.unref();
  return { name, pid: child.pid, file: log.file, spawned };
}

/**
 * Three direct children, each in its own process group and log file. A supervisor
 * process would add a second lifecycle to reason about; the instance record already is
 * the source of truth.
 */
async function startDetached(instance) {
  const started = [];
  const spawnOne = (name, commandLine, commandArgs, options) => {
    started.push(spawnDetachedService(instance, name, commandLine, commandArgs, options));
  };

  try {
    spawnOne('api', mvnw, ['spring-boot:run', '--no-transfer-progress'], {
      cwd: path.join(ROOT, 'api'),
      env: { ...buildApiDevEnv(instance), SPRING_OUTPUT_ANSI_ENABLED: 'NEVER' },
    });
    spawnOne('web', 'pnpm', ['exec', 'turbo', 'run', 'dev', '--filter', 'web'], {
      cwd: ROOT,
      env: plainLogEnv(buildWebDevEnv(instance)),
    });
    spawnOne('realtime', 'pnpm', ['exec', 'turbo', 'run', 'dev', '--filter', 'realtime'], {
      cwd: ROOT,
      env: plainLogEnv(buildRealtimeDevEnv(instance)),
    });
    await Promise.all(started.map((service) => service.spawned));
  } catch (err) {
    await Promise.all(started.map((service) => stopProcessGroup(service.pid)));
    throw err;
  }

  return started;
}

function printLifecycleHints() {
  console.log('  logs     ./nd logs [api|web|realtime] -n 50');
  console.log('  stop     ./nd stop');
  console.log('');
}

function printLogTails(services, limit, only = null) {
  const targets = only ? services.filter((service) => only.includes(service.name)) : services;
  console.error('');
  for (const service of targets) {
    const { file, lines } = tailSession(service.name, limit);
    console.error(`--- ${service.name} (${path.relative(ROOT, file)}) ---`);
    console.error(lines.length === 0 ? '(no output)' : lines.join('\n'));
    console.error('');
  }
}

function emitJson(value) {
  // `process.stdout.write` is asynchronous when stdout is a pipe (the agent contract
  // case: `./nd logs --json | jq`), and every caller exits as soon as the command
  // returns. Writing the fd directly flushes the whole document before that exit.
  writeStdout(`${JSON.stringify(value, null, 2)}\n`);
}

/** Writes to stdout without leaving anything in the stream buffer for `process.exit`. */
function writeStdout(text) {
  try {
    fs.writeSync(1, text);
  } catch (err) {
    // A reader that already closed the pipe (`| head`) has nowhere left to accept it;
    // the command's own exit status still describes the work it did.
    if (err.code !== 'EPIPE' && err.code !== 'EBADF') throw err;
  }
}

function instanceUrls(instance) {
  return {
    web: `http://localhost:${instance.ports.web}`,
    api: `http://localhost:${instance.ports.api}`,
    realtime: `http://localhost:${instance.ports.realtime}`,
  };
}

function sessionPayload(instance, health, pids) {
  return {
    instance: instance.id,
    worktree: instance.worktree,
    status: 'running',
    healthy: health,
    urls: instanceUrls(instance),
    ports: { ...instance.ports },
    database: {
      api: instance.database,
      yhub: instance.yhubDatabase,
      redisPrefix: instance.redisPrefix,
    },
    pids: { ...pids },
    logs: Object.fromEntries(ALL_SERVICES.map((name) => [name, logFile(name)])),
    envFile: envFilePath(),
  };
}

/**
 * In JSON mode stdout is reserved for the one result document. Banner and setup
 * progress moves to stderr, including child `docker start` output (via the fd
 * redirect in proc.run), so a first-time start cannot corrupt the document.
 */
function silenceStdout() {
  const original = console.log;
  console.log = (...args) => console.error(...args);
  redirectRunStdout(true);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    console.log = original;
    redirectRunStdout(false);
  };
}

/**
 * Idempotent, health-gated start. The contract for agents: exit 0 means all three
 * URLs answer; a failure leaves no half-started stack behind.
 */
async function upCommand() {
  if (service) {
    throw new Error('`./nd up` starts the full stack; it does not take a service argument.');
  }

  const timeout = readinessTimeout();
  const instance = await resolveInstance({
    newPorts,
    portOffset,
    attachmentStorage: attachmentStoragePath(),
  });
  setInstance(instance);

  const restore = wantJson ? silenceStdout() : () => {};
  let outcome;
  try {
    outcome = await runUp(instance, timeout);
  } finally {
    restore();
  }

  if (outcome.code !== 0) return outcome.code;
  if (wantJson) emitJson(outcome.session);
  return 0;
}

/**
 * Ctrl+C during the readiness wait used to leave the services this run started listening
 * on the worktree's ports with no supervisor to stop them, and the next `./nd up` then
 * reported those ports as busy. The returned function detaches the handlers again.
 */
function trapInterrupt(cleanup) {
  const handler = (signal) => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
    console.error(`\n\x1b[33m… ${signal}: stopping the services this run started.\x1b[0m`);
    Promise.resolve()
      .then(cleanup)
      .catch(() => {})
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

async function runUp(instance, timeout) {
  const live = liveServicePids(instance);
  if (Object.keys(live).length > 0) {
    const missing = ALL_SERVICES.filter((name) => !live[name]);
    if (missing.length > 0) {
      console.error(
        `\x1b[31m✗ Instance '${instance.id}' is running detached but ${missing.join(', ')} ` +
          `${missing.length === 1 ? 'is' : 'are'} not running. No restart was attempted; ` +
          'check the log, then `./nd stop && ./nd up`.\x1b[0m'
      );
      printLogTails(
        ALL_SERVICES.map((name) => ({ name })),
        30,
        missing
      );
      return { code: 1 };
    }

    console.log(
      `\x1b[34m> Instance '${instance.id}' is already running detached. Waiting for health...\x1b[0m`
    );
    const { ready, pending, health } = await waitForServices(instance, ALL_SERVICES, timeout);
    if (!ready) {
      console.error(
        `\x1b[31m✗ Instance '${instance.id}' is running but not ready: ${pending.join(', ')}. ` +
          'It was left running; check the log below. `ND_READY_TIMEOUT_MS` extends the wait.\x1b[0m'
      );
      printLogTails(
        ALL_SERVICES.map((name) => ({ name })),
        30,
        pending
      );
      return { code: 1 };
    }
    printReadyBanner(instance);
    printLifecycleHints();
    return { code: 0, session: sessionPayload(instance, health, live) };
  }

  if (instance.running) {
    const supervisors = liveSupervisors(instance)
      .map((entry) => `${entry.pid} (${servicesOf(entry).join(', ')})`)
      .join('; ');
    console.error(
      `\x1b[31m✗ Instance '${instance.id}' is running in the foreground (pid ${supervisors}). ` +
        'Run `./nd stop` first.\x1b[0m'
    );
    return { code: 1 };
  }

  await assertPortsAvailable(instance, ALL_SERVICES);

  ensureJsWorkspaceReady('all');
  preflightDocker();

  // Provision, spawn and record under the same claim `db reset` takes: a reset that
  // confirms while this run is starting refuses or waits instead of dropping the
  // databases this stack is about to use.
  const claim = await claimLifecycle(instance, 'up');
  let started;
  let pids;
  try {
    // Same recheck as `./nd dev`: a start that won the claim while this run waited has
    // already recorded its services, and starting a second stack would rebind its ports.
    const current = refreshRecord(instance);
    if (recordIsRunning(current)) {
      throw new Error(
        `Instance '${instance.id}' started while this run was waiting for it. ` +
          'No restart was attempted; use `./nd logs` or `./nd stop` first.'
      );
    }
    ensurePostgres({ yhubSchema: true, local: true });
    ensureRedis();
    // Only the API sends mail. A detached start includes it, but an external SMTP host
    // means Mailpit is not wanted (and must not block the start on its ports).
    if (devUsesLocalMailpit('api')) ensureMailpit();

    writeInstanceEnvFile(instance);
    clearServicePids(instance);
    printBanner(instance, 'up');

    started = await startDetached(instance);
    pids = Object.fromEntries(started.map(({ name, pid }) => [name, pid]));
    // `updateRecord` returns null when the record disappeared under us. Without a
    // record, `./nd stop` cannot see these pids, so a failed write has to stop them.
    if (!setServicePids(instance, pids)) {
      throw new Error(`Could not record the started services in ${instance.registry}.`);
    }
  } catch (err) {
    if (started) {
      const { retained } = await stopStarted(started);
      clearServicePids(instance, retained);
    }
    throw err;
  } finally {
    releaseInstanceClaim(claim);
  }

  console.log(
    `\x1b[34m> Waiting up to ${Math.round(timeout / 1000)}s for api, web and realtime...\x1b[0m`
  );
  const releaseInterrupt = trapInterrupt(async () => {
    const { retained } = await stopStarted(started);
    clearServicePids(instance, retained);
  });
  let health;
  let pending;
  let ready;
  try {
    ({ ready, pending, health } = await waitForServices(instance, ALL_SERVICES, timeout));
  } finally {
    releaseInterrupt();
  }
  if (!ready) {
    const { retained } = await stopStarted(started);
    clearServicePids(instance, retained);
    console.error(
      `\x1b[31m✗ NextDocs '${instance.id}' did not become ready: ${pending.join(', ')}. ` +
        'Stopped the services this run started. `ND_READY_TIMEOUT_MS` extends the wait; ' +
        'logs follow.\x1b[0m'
    );
    printLogTails(started, 30, pending);
    return { code: 1 };
  }

  // The probes are HTTP: a service can answer and exit before this line. Reporting a
  // ready stack that already lost a service is the one outcome `up` must not produce.
  const exited = started.filter((service) => !isPidAlive(service.pid));
  if (exited.length > 0) {
    const { retained } = await stopStarted(started.filter((service) => isPidAlive(service.pid)));
    clearServicePids(instance, retained);
    console.error(
      `\x1b[31m✗ NextDocs '${instance.id}' answered, but ${exited
        .map((service) => service.name)
        .join(', ')} exited during the readiness check. Stopped the rest.\x1b[0m`
    );
    printLogTails(exited, 30);
    return { code: 1 };
  }

  printReadyBanner(instance);
  printLifecycleHints();
  return { code: 0, session: sessionPayload(instance, health, pids) };
}

/**
 * Stop processes this run started and report the ones that survived. A pid that could
 * not be terminated stays in the instance record, so a later `./nd stop` can retry it
 * instead of losing every trace of the process.
 */
async function stopStarted(services) {
  const results = await Promise.all(
    services.map(async (entry) => ({ ...entry, stopped: await stopProcessGroup(entry.pid) }))
  );
  const failed = results.filter((entry) => !entry.stopped);
  if (failed.length > 0) {
    console.error(
      `\x1b[31m✗ Could not stop ${failed.map((entry) => `${entry.name} (pid ${entry.pid})`).join(', ')}. ` +
        'Their pids stay recorded so `./nd stop` can retry.\x1b[0m'
    );
  }
  return {
    failed,
    retained: Object.fromEntries(failed.map((entry) => [entry.name, entry.pid])),
  };
}

// --- Shared local infrastructure -------------------------------------------------

/**
 * Mailpit has no auth and keeps every message it captures, so it is published on the
 * loopback interface only. An existing container may predate that, and `docker start`
 * reuses its original port bindings.
 */
function mailpitIsLoopbackOnly() {
  const ports = runSilent(`docker port ${MAILPIT_CONTAINER}`);
  if (ports.status !== 0) {
    return false;
  }

  const bindings = ports.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return bindings.length === 2 && bindings.every((binding) => binding.includes(' -> 127.0.0.1:'));
}

function ensureMailpit() {
  const check = runSilent(`docker inspect -f "{{.State.Running}}" ${MAILPIT_CONTAINER}`);
  const exists = check.status === 0;
  const isRunning = exists && check.stdout.toString().trim() === 'true';

  if (exists && !mailpitIsLoopbackOnly()) {
    console.log(`\x1b[34m> Recreating mailpit with loopback-only ports...\x1b[0m`);
    run(`docker rm -f ${MAILPIT_CONTAINER}`);
  } else if (isRunning) {
    console.log(
      `\x1b[32m✓ Mailpit already running (Web UI: http://localhost:${MAILPIT_WEB_PORT})\x1b[0m`
    );
    return;
  } else if (exists) {
    console.log(`\x1b[34m> Starting existing mailpit container...\x1b[0m`);
    run(`docker start ${MAILPIT_CONTAINER}`);
    console.log(
      `\x1b[32m✓ Mailpit web UI available at http://localhost:${MAILPIT_WEB_PORT}\x1b[0m`
    );
    return;
  }

  console.log(`\x1b[34m> Starting mailpit container...\x1b[0m`);
  startSharedContainer(
    [
      'docker run -d',
      `--name ${MAILPIT_CONTAINER}`,
      `-p 127.0.0.1:${MAILPIT_SMTP_PORT}:1025`,
      `-p 127.0.0.1:${MAILPIT_WEB_PORT}:8025`,
      MAILPIT_IMAGE,
    ].join(' '),
    MAILPIT_CONTAINER
  );
  console.log(`\x1b[32m✓ Mailpit web UI available at http://localhost:${MAILPIT_WEB_PORT}\x1b[0m`);
}

/**
 * Mailpit is a development-only sink, and only the API sends through it: a web or
 * realtime run must not start it. An external `SPRING_MAIL_HOST` means the API does
 * not want it either.
 */
function devUsesLocalMailpit(svc) {
  return (!svc || svc === 'api') && isKeyEmptyOrPlaceholder(process.env.SPRING_MAIL_HOST);
}

// --- Workspace checks ------------------------------------------------------------

function preflightDocker() {
  const cli = runSilent('docker --version', { timeout: 5000 });
  if (cli.status !== 0) {
    throw new Error('Docker is not installed or not on PATH. Install Docker and retry.');
  }

  const daemon = runSilent('docker info --format "{{.ServerVersion}}"', { timeout: 8000 });
  if (daemon.status !== 0) {
    throw new Error('Docker is installed but the daemon is not reachable. Start Docker and retry.');
  }
}

function verifyWorkspaceLockfilePolicy() {
  const found = findForbiddenLockfiles(ROOT);
  const missingRootLockfile = !fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml'));
  if (found.length === 0 && !missingRootLockfile) return;

  const parts = [];
  if (found.length > 0) {
    parts.push(
      `Remove ${found.map((filePath) => path.relative(ROOT, filePath)).join(', ')}; ` +
        'only the root pnpm-lock.yaml is allowed.'
    );
  }
  if (missingRootLockfile) parts.push('The root pnpm-lock.yaml is missing.');

  throw new Error(`${parts.join(' ')} Then run \`pnpm install --frozen-lockfile\`.`);
}

function verifyJsWorkspaceInstall(target = 'all') {
  const missing = [];

  for (const binaryPath of REQUIRED_JS_BINARIES) {
    if (!fs.existsSync(binaryPath)) {
      missing.push(path.relative(ROOT, binaryPath));
    }
  }

  const targets = target === 'all' ? ['web', 'realtime'] : [target];
  for (const svc of targets) {
    const requiredPackages = REQUIRED_WORKSPACE_PACKAGES[svc] || [];
    for (const packageName of requiredPackages) {
      const packageCandidates = [
        path.join(ROOT, 'node_modules', packageName, 'package.json'),
        path.join(ROOT, svc, 'node_modules', packageName, 'package.json'),
      ];
      const found = packageCandidates.some((candidatePath) => fs.existsSync(candidatePath));
      if (!found) {
        missing.push(`${svc}:${packageName}`);
      }
    }
  }

  if (missing.length === 0) return;

  throw new Error(
    `Workspace dependencies are missing (${missing.join(', ')}). ` +
      'Run `pnpm install --frozen-lockfile` from the repository root.'
  );
}

function ensurePnpm() {
  const probe = runSilent('pnpm --version', { timeout: 10_000 });
  if (probe.status === 0) return;

  throw new Error(
    `pnpm is not on PATH (running Node ${process.version} at ${process.execPath}). ` +
      `This workspace pins ${ROOT_PACKAGE.packageManager || 'pnpm'}. ` +
      'Run `nvm use` to load the version from .nvmrc, install pnpm globally, ' +
      'or enable Corepack, then retry.'
  );
}

function ensureJsWorkspaceReady(target = 'all') {
  ensurePnpm();
  verifyWorkspaceLockfilePolicy();
  verifyJsWorkspaceInstall(target);
}

function turbo(task, filter, extraArgs = '') {
  const filterFlag = filter ? ` --filter=${filter}` : '';
  return run(`pnpm exec turbo run ${task}${filterFlag}${extraArgs}`);
}

// --- Non-dev commands ------------------------------------------------------------

const API_COMMANDS = {
  lint: isFix
    ? `${mvnw} spotless:apply --no-transfer-progress`
    : `${mvnw} spotless:check --no-transfer-progress`,
  test: `${mvnw} test --no-transfer-progress`,
  build: `${mvnw} package -DskipTests --no-transfer-progress`,
  dev: `${mvnw} spring-boot:run`,
  format: `${mvnw} spotless:apply --no-transfer-progress`,
};

function usage(exitCode = 1) {
  console.log(
    'Usage: ./nd <command> [service|profile] [--fix] [--new-ports] [--port-offset N] [--json]'
  );
  console.log();
  console.log('Commands:');
  console.log('  dev [service]       Start dev servers in the foreground (--detach: full stack)');
  console.log('  up                  Start the full stack detached and wait until it is ready');
  console.log('  stop [--infra]      Stop this worktree’s foreground or detached stack');
  console.log(
    '  logs [service]      Recent detached logs (-n N, default 100; --clear removes them)'
  );
  console.log('  status              Show every worktree instance and the shared containers');
  console.log('  urls [--env]        Print this worktree’s URLs (--env: sourceable exports)');
  console.log('  down [--infra]      Alias of stop (--infra: also stops shared containers)');
  console.log('  lint [service]      Run linters (--fix to auto-fix)');
  console.log('  format [service]    Run formatters (--fix to auto-fix)');
  console.log('  test [service]      Run tests');
  console.log('  build [service]     Build packages');
  console.log('  db [command]        Open psql (no argument) or run a db command');
  console.log('  seed [profile]      Seed a fresh local database (small|regular|large)');
  console.log();
  console.log(`Services: ${ALL_SERVICES.join(', ')}`);
  console.log('Omit service to run across all.');
  console.log();
  console.log('Each git worktree gets its own ports, databases and Redis prefix;');
  console.log('ports are picked once and reused. --new-ports re-rolls them,');
  console.log('--port-offset N shifts the base (3000/8080/1234) by N.');
  console.log('`dev`, `up` and `db reset` claim the worktree while they provision or');
  console.log('drop it, so a reset cannot race a start.');
  console.log('');
  console.log('Detached logs are replaced on each start. One long session keeps growing');
  console.log('its file (the child writes directly to the descriptor, so it cannot be');
  console.log('rotated); `./nd logs --clear` removes them once the stack is stopped.');
  console.log();
  console.log('  --json              Machine-readable output (up, status, urls, logs, stop)');
  console.log();
  console.log('Database commands: ./nd db --help');
  process.exit(exitCode);
}

function validateService(svc) {
  if (!ALL_SERVICES.includes(svc)) {
    console.error(`Unknown service: '${svc}'. Valid services: ${ALL_SERVICES.join(', ')}`);
    process.exit(1);
  }
}

function runForService(task, svc) {
  validateService(svc);
  if (svc === 'api') {
    if (!API_COMMANDS[task]) {
      console.error(`Command '${task}' not supported for api`);
      process.exit(1);
    }
    return run(API_COMMANDS[task], { cwd: path.join(ROOT, 'api') });
  }

  ensureJsWorkspaceReady(svc);
  return turbo(task, svc);
}

function runForAll(task) {
  console.log(`\n--- API ---`);
  const apiStatus = run(API_COMMANDS[task] || 'echo skipped', {
    cwd: path.join(ROOT, 'api'),
    exitOnError: false,
  });

  console.log(`\n--- WEB + REALTIME ---`);
  ensureJsWorkspaceReady('all');
  let turboTask = task;
  if (task === 'format' && isFix) turboTask = 'format:fix';
  const turboStatus = turbo(turboTask, null, task === 'lint' && isFix ? ' -- --fix' : '');

  if (apiStatus !== 0 || turboStatus !== 0) process.exit(1);
}

function truncateMiddle(value, width) {
  if (value.length <= width) return value.padEnd(width);
  const keep = width - 1;
  return `…${value.slice(value.length - keep)}`;
}

function emptyHealth() {
  return { web: false, api: false, realtime: false };
}

async function anyPortListening(record) {
  const ports = Object.values(record.ports || {});
  const open = await Promise.all(ports.map((port) => portOpen(port)));
  return open.some(Boolean);
}

/**
 * One probe per instance, shared by `--json` and the table so the two cannot disagree.
 * `health` is the HTTP answer; `listening` is whether any of the instance's ports accept
 * a connection, which is how a stack started before instances existed is recognised.
 */
async function probeRecord(record) {
  if (!isWorktreePresent(record)) return { health: emptyHealth(), listening: false };
  const listening = await anyPortListening(record);
  const maybeRunning =
    Object.keys(liveServicePids(record)).length > 0 || liveSupervisors(record).length > 0;

  if (!maybeRunning && !listening) return { health: emptyHealth(), listening };
  return { health: await probeHealth(record, 1500), listening };
}

function describeState(record, probe, live) {
  if (!isWorktreePresent(record)) return 'missing worktree';
  if (Object.keys(live).length > 0) return 'detached';
  if (liveSupervisors(record).length > 0) return 'foreground';
  if (probe.listening || probe.health.web || probe.health.api || probe.health.realtime) {
    return 'running';
  }
  return 'stopped';
}

async function probeInstances(records) {
  return Promise.all(
    records.map(async (record) => {
      const probe = await probeRecord(record);
      const live = liveServicePids(record);
      return { record, probe, live, state: describeState(record, probe, live) };
    })
  );
}

function statusPayload(instance, statuses) {
  const instances = statuses.map(({ record, probe, live, state }) => ({
    id: record.id,
    worktree: record.worktree,
    state,
    healthy: probe.health,
    ports: { ...record.ports },
    database: record.database,
    yhubDatabase: record.yhubDatabase,
    redisPrefix: record.redisPrefix,
    pids: live,
    supervisors: liveSupervisors(record).map((entry) => ({
      pid: entry.pid,
      services: servicesOf(entry),
    })),
  }));

  return {
    worktree: instance.worktree,
    instance: instance.id,
    infra: {
      postgres: { running: containerRunning(POSTGRES_CONTAINER), port: Number(POSTGRES_PORT) },
      redis: { running: containerRunning(REDIS_CONTAINER), port: Number(REDIS_PORT) },
      mailpit: { running: containerRunning(MAILPIT_CONTAINER), port: Number(MAILPIT_WEB_PORT) },
    },
    instances,
  };
}

async function statusCommand() {
  const instance = peekInstance();
  const records = listRecords(instance.registry);
  const statuses = await probeInstances(records);

  if (wantJson) {
    emitJson(statusPayload(instance, statuses));
    return 0;
  }

  console.log('');
  if (records.length === 0) {
    console.log('No instances recorded yet. Run `./nd dev` in any worktree.');
  } else {
    console.log(
      `${truncateMiddle('worktree', 38)} ${'id'.padEnd(22)} ${'web'.padEnd(6)} ${'api'.padEnd(6)} ${'rt'.padEnd(6)} state`
    );
    for (const { record, state } of statuses) {
      const marker = record.id === instance.id ? '*' : ' ';
      console.log(
        `${marker}${truncateMiddle(record.worktree.replace(os.homedir(), '~'), 37)} ` +
          `${record.id.padEnd(22)} ${String(record.ports.web).padEnd(6)} ` +
          `${String(record.ports.api).padEnd(6)} ${String(record.ports.realtime).padEnd(6)} ${state}`
      );
    }
  }

  const postgres = containerRunning(POSTGRES_CONTAINER);
  const redis = containerRunning(REDIS_CONTAINER);
  const mailpit = containerRunning(MAILPIT_CONTAINER);
  console.log('');
  console.log(
    `infra  postgres :${POSTGRES_PORT} ${postgres ? 'running' : 'stopped'} · ` +
      `redis :${REDIS_PORT} ${redis ? (redisPing() ? 'running' : 'unhealthy') : 'stopped'} · ` +
      `mailpit :${MAILPIT_WEB_PORT} ${mailpit ? 'running' : 'stopped'}`
  );
  if (containerRunning(REDIS_CONTAINER)) {
    console.log(`       this worktree's Yhub prefix is '${instance.redisPrefix}'`);
  }
  console.log('');
  return 0;
}

async function urlsCommand(argv) {
  const instance = peekInstance();
  const wantsEnv = argv.includes('--env');

  if (wantJson) {
    if (wantsEnv) throw new Error('Choose either --env or --json, not both.');
    emitJson({
      instance: instance.id,
      worktree: instance.worktree,
      hasRecord: instance.hasRecord,
      urls: instanceUrls(instance),
      ports: { ...instance.ports },
      database: {
        api: instance.database,
        yhub: instance.yhubDatabase,
        redisPrefix: instance.redisPrefix,
      },
      envFile: envFilePath(),
    });
    return 0;
  }

  if (wantsEnv) {
    writeStdout(renderInstanceEnv(instance));
    return 0;
  }
  printBanner(instance, 'urls');
  if (!instance.hasRecord) {
    console.log('  These are the defaults; `./nd dev` will allocate and persist them.');
    console.log('');
  }
  return 0;
}

function parseLogLineCount(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error(`${flag} requires an integer between 1 and 10000, received "${raw}".`);
  }
  return value;
}

async function logsCommand(argv) {
  let serviceName = null;
  let limit = 100;
  let clear = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--clear') {
      clear = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: ./nd logs [service] [-n N] [--clear]

Prints the newest lines of this worktree's detached service logs. Each start replaces
its service log, but one long-running session keeps appending to its file: the page
policy caps nothing inside a session because the child writes straight to the file
descriptor (renaming the file cannot rotate it). Run --clear after ./nd stop to reclaim
that space.`);
      return 0;
    } else if (arg === '-n' || arg === '--lines') {
      limit = parseLogLineCount(argv[index + 1], arg);
      index += 1;
    } else if (arg.startsWith('--lines=')) {
      limit = parseLogLineCount(arg.slice('--lines='.length), '--lines');
    } else if (arg.startsWith('-n=')) {
      limit = parseLogLineCount(arg.slice('-n='.length), '-n');
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option for logs: ${arg}`);
    } else if (serviceName) {
      throw new Error(
        `./nd logs takes at most one service, received '${serviceName}' and '${arg}'.`
      );
    } else {
      serviceName = arg;
    }
  }

  if (serviceName) validateService(serviceName);
  const services = serviceName ? [serviceName] : ALL_SERVICES;
  if (clear) {
    if (wantJson) throw new Error('Choose either --clear or --json, not both.');
    return await clearLogs(services);
  }

  if (wantJson) {
    const logs = services.map((name) => {
      const { file, lines, missing } = tailFile(name, limit);
      return { service: name, file, lines, ...(missing ? { missing: true } : {}) };
    });
    emitJson({ instance: peekInstance().id, logs });
    return 0;
  }

  for (const name of services) {
    const { file, lines: content, missing } = tailFile(name, limit);
    console.log('');
    console.log(`--- ${name} — ${path.relative(ROOT, file)} ---`);
    if (missing) {
      console.log('(no log yet; start the detached stack with ./nd up)');
    } else if (content.length === 0) {
      console.log('(empty)');
    } else {
      for (const line of content) console.log(line);
    }
  }
  console.log('');
  return 0;
}

/**
 * Reclaim the space of service logs. Only safe when the stack is stopped: a running
 * child holds the file descriptor, so removing the path would leave it writing to an
 * unlinked inode and free nothing. The ports are probed as well as the record, because a
 * stack started by an older CLI has pids this registry never saw.
 */
async function clearLogs(services) {
  const instance = peekInstance({ applyPins: false });
  const own = listRecords(instance.registry).find((record) => record.id === instance.id);
  const running = (own && recordIsRunning(own)) || (await anyPortListening(instance));
  if (running) {
    throw new Error(
      `Refusing to clear logs while instance '${instance.id}' is running; run \`./nd stop\` first.`
    );
  }
  let removed = 0;
  for (const name of services) {
    const file = logFile(name);
    if (!fs.existsSync(file)) continue;
    const size = fs.statSync(file).size;
    fs.rmSync(file, { force: true });
    removed += 1;
    console.log(`Removed ${path.relative(ROOT, file)} (${size} bytes).`);
  }
  if (removed === 0) console.log('No service logs to remove.');
  return 0;
}

/**
 * Windows has no `ps -o command=`. WMI/CIM gives the command line, which is what the
 * Linux branch uses to avoid signalling a recycled PID. If PowerShell is unavailable
 * the caller must skip rather than guess, even though that can leave a stale stack.
 */
function windowsCommandLine(pid) {
  const script = `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`;
  const result = runSilent(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
    timeout: 5000,
  });
  return result.status === 0 ? result.stdout.toString().trim() : null;
}

function isNdProcess(pid) {
  if (!isPidAlive(pid)) return false;
  if (isWin) {
    const commandLine = windowsCommandLine(pid);
    return commandLine != null && /scripts[\\/]nd\.js/.test(commandLine);
  }
  const result = runSilent(`ps -p ${pid} -o command=`, { timeout: 3000 });
  if (result.status !== 0) return false;
  return /scripts\/nd\.js/.test(result.stdout.toString());
}

/**
 * Terminate a detached/forked process tree. Returns whether termination is confirmed:
 * a caller that clears the recorded pid must know the process is really gone, otherwise
 * `./nd stop` loses the only handle it has for a retry.
 */
async function stopProcessGroup(pid) {
  if (isWin) {
    if (!isPidAlive(pid)) return true;
    // process.kill(pid) only terminates the shell on Windows; taskkill /T follows the
    // mvnw/pnpm children (java, turbo, next, tsx) as well.
    runSilent(`taskkill /pid ${pid} /T /F`, { timeout: 15_000 });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isPidAlive(pid)) {
      await sleep(200);
    }
    return !isPidAlive(pid);
  }
  // On POSIX the group outlives its leader: the shell can exit while the server it
  // started keeps the port, so signal the group even when `pid` itself is already gone.

  const signal = (name) => {
    try {
      process.kill(-pid, name);
    } catch {
      try {
        process.kill(pid, name);
      } catch {
        // Already gone.
      }
    }
  };

  // The recorded pid is the spawned process (a shell on Windows) and the server is a
  // descendant in the same group. Waiting on the leader alone would return while that
  // descendant still holds the port, and the caller would then clear its record. A
  // foreground supervisor is not a group leader, so the pid itself has to be checked too.
  const groupAlive = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM';
    }
  };
  const alive = () => isPidAlive(pid) || groupAlive();

  signal('SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && alive()) {
    await sleep(200);
  }
  if (!alive()) return true;
  signal('SIGKILL');
  const killDeadline = Date.now() + 2000;
  while (Date.now() < killDeadline && alive()) {
    await sleep(100);
  }
  return !alive();
}

const SERVICE_PROCESS_PATTERNS = {
  api: /spring-boot:run|NextdocsApiApplication/,
  web: /turbo|scripts[/\\]dev\.mjs|next[/\\]dist[/\\]bin[/\\]next/,
  realtime: /turbo|tsx|src[/\\]main\.ts/,
};

/** A recorded pid can be reused by an unrelated process; never signal one blindly. */
function looksLikeService(pid, name) {
  if (!isPidAlive(pid)) return false;
  if (isWin) {
    const commandLine = windowsCommandLine(pid);
    return commandLine != null && SERVICE_PROCESS_PATTERNS[name].test(commandLine);
  }
  const result = runSilent(`ps -p ${pid} -o command=`, { timeout: 3000 });
  if (result.status !== 0) return false;
  return SERVICE_PROCESS_PATTERNS[name].test(result.stdout.toString());
}

async function stopCommand(argv) {
  // `applyPins: false`: a shell that exported a different ND_*_PORT must still be able to
  // run the very stop command its own start error suggests. The record has the ports.
  const instance = peekInstance({ applyPins: false });
  const records = listRecords(instance.registry);
  const own = records.find((record) => record.id === instance.id);
  const log = wantJson ? () => {} : (...args) => console.log(...args);
  const stoppedEntries = [];
  const failed = [];

  for (const entry of liveSupervisors(own || {})) {
    if (!isNdProcess(entry.pid)) {
      console.error(
        `\x1b[33m… Skipping foreground pid ${entry.pid}: it no longer looks like ./nd. ` +
          'Clearing the stale record.\x1b[0m'
      );
      clearSupervisor(instance, entry.pid);
      continue;
    }
    log(
      `\x1b[34m> Stopping foreground dev for '${instance.id}' ` +
        `(pid ${entry.pid}, ${servicesOf(entry).join(', ')})...\x1b[0m`
    );
    if (await stopProcessGroup(entry.pid)) {
      stoppedEntries.push({ name: 'dev', pid: entry.pid });
      clearSupervisor(instance, entry.pid);
    } else {
      failed.push({ name: 'dev', pid: entry.pid });
    }
  }

  const toStop = [];
  for (const [name, pid] of Object.entries(liveServicePids(own || {}))) {
    if (!looksLikeService(pid, name)) {
      console.error(
        `\x1b[33m… Skipping ${name} pid ${pid}: it no longer looks like this service. ` +
          'Clearing the stale record.\x1b[0m'
      );
      continue;
    }
    log(`\x1b[34m> Stopping ${name} (pid ${pid})...\x1b[0m`);
    toStop.push({ name, pid });
  }
  const stopped = await Promise.all(
    toStop.map(async (service) => ({ ...service, ok: await stopProcessGroup(service.pid) }))
  );
  for (const entry of stopped) {
    if (entry.ok) stoppedEntries.push({ name: entry.name, pid: entry.pid });
    else failed.push({ name: entry.name, pid: entry.pid });
  }
  if (own) {
    // Keep the pids this run could not confirm as gone: the record is the retry handle.
    clearServicePids(
      instance,
      Object.fromEntries(
        failed.filter((entry) => entry.name !== 'dev').map((entry) => [entry.name, entry.pid])
      )
    );
  }

  if (stoppedEntries.length === 0 && failed.length === 0) {
    log(`No running dev process recorded for '${instance.id}'.`);
  }
  if (failed.length > 0) {
    console.error(
      `\x1b[31m✗ Could not confirm that ${failed
        .map((entry) => `${entry.name} (pid ${entry.pid})`)
        .join(
          ', '
        )} stopped. Their records are kept; fix the process or retry \`./nd stop\`.\x1b[0m`
    );
    if (wantJson) {
      emitJson({
        instance: instance.id,
        stopped: stoppedEntries,
        failed,
        infra: 'left running',
      });
    }
    return 1;
  }

  const stopInfra = argv.includes('--infra') || argv.includes('--all');
  if (!stopInfra) {
    log('Shared containers were left running; `./nd stop --infra` stops them.');
    if (wantJson) {
      emitJson({ instance: instance.id, stopped: stoppedEntries, infra: 'left running' });
    }
    return 0;
  }

  const others = [];
  for (const record of records) {
    if (record.id === instance.id) continue;
    if (recordIsRunning(record)) {
      others.push(record.id);
      continue;
    }
    const listening = (
      await Promise.all(Object.values(record.ports || {}).map((port) => portOpen(port)))
    ).some(Boolean);
    if (listening) others.push(record.id);
  }
  if (others.length > 0) {
    console.error(
      `\x1b[31mRefusing to stop shared containers: instance(s) still running: ${others.join(', ')}.\x1b[0m`
    );
    return 1;
  }

  // A stack started by an older CLI (or by hand) has no record here. Stopping the
  // containers under it would kill someone else's session, so require --force.
  const legacy = await Promise.all([3000, 8080, 1234].map((port) => portOpen(port)));
  if (legacy.some(Boolean) && !argv.includes('--force')) {
    console.error(
      '\x1b[31mPorts 3000/8080/1234 are still listening (a stack not started by this CLI?). ' +
        'Stop it first, or re-run with --force.\x1b[0m'
    );
    return 1;
  }

  log('\x1b[34m> Stopping shared containers...\x1b[0m');
  const containers = [POSTGRES_CONTAINER, REDIS_CONTAINER, MAILPIT_CONTAINER];
  const stopResult = runSilent(`docker stop ${containers.join(' ')}`, { timeout: 60_000 });
  if (stopResult.status !== 0) {
    // `docker stop` also fails for a container that was never created; absent is a
    // no-op. A container that is still running, or a daemon that cannot be reached, is
    // not: reporting "stopped" there would leave a stack behind.
    const daemon = runSilent('docker info --format "{{.ServerVersion}}"', { timeout: 8000 });
    const stillRunning = containers.filter((name) => containerRunning(name));
    if (daemon.status !== 0 || stillRunning.length > 0) {
      const detail =
        (stopResult.stderr || '').toString().trim() || `docker stop exited ${stopResult.status}`;
      console.error(
        `\x1b[31m✗ Could not stop ${
          stillRunning.length > 0 ? stillRunning.join(', ') : 'the shared containers'
        }: ${detail}\x1b[0m`
      );
      return 1;
    }
  }
  log('\x1b[32m✓ Shared containers stopped.\x1b[0m');
  if (wantJson) {
    emitJson({ instance: instance.id, stopped: stoppedEntries, infra: 'stopped' });
  }
  return 0;
}

async function main() {
  if (!command) usage(1);
  if (command === '--help' || command === '-h' || command === 'help') usage(0);
  if (detached && command !== 'dev' && command !== 'up') {
    console.error('--detach is only valid with `./nd dev`.');
    process.exit(1);
  }
  if (wantJson && command === 'dev' && !detached) {
    console.error('--json with `./nd dev` requires `--detach`; use `./nd up --json`.');
    process.exit(1);
  }
  if (wantJson && !JSON_COMMANDS.has(command)) {
    console.error('--json is supported by: up, status, urls, logs, stop, and dev --detach.');
    process.exit(1);
  }

  switch (command) {
    case 'dev':
      await devCommand();
      break;

    case 'up':
      process.exit(await upCommand());
      break;

    case 'status':
      process.exit(await statusCommand());
      break;

    case 'urls':
      process.exit(await urlsCommand(args.slice(1)));
      break;

    case 'logs':
      process.exit(await logsCommand(args.slice(1)));
      break;

    case 'stop':
    case 'down':
      process.exit(await stopCommand(args.slice(1)));
      break;

    case 'lint':
      if (service) {
        validateService(service);
        if (service === 'api' && isFix) {
          run(`${mvnw} spotless:apply --no-transfer-progress`, { cwd: path.join(ROOT, 'api') });
        } else if (service === 'api') {
          run(`${mvnw} spotless:check --no-transfer-progress`, { cwd: path.join(ROOT, 'api') });
        } else {
          ensureJsWorkspaceReady(service);
          turbo('lint', service, isFix ? ' -- --fix' : '');
        }
      } else {
        runForAll('lint');
      }
      break;

    case 'format':
      if (service) {
        validateService(service);
        if (service === 'api') {
          run(`${mvnw} spotless:apply --no-transfer-progress`, { cwd: path.join(ROOT, 'api') });
        } else {
          ensureJsWorkspaceReady(service);
          turbo(isFix ? 'format:fix' : 'format', service);
        }
      } else {
        runForAll('format');
      }
      break;

    case 'test':
      if (service) runForService('test', service);
      else runForAll('test');
      break;

    case 'build':
      if (service) runForService('build', service);
      else runForAll('build');
      break;

    case 'db':
      setInstance(peekInstance());
      process.exit(
        await require('./db')(args.slice(1))
          .then((code) => code)
          .catch((err) => {
            console.error(`\x1b[31m${err.message}\x1b[0m`);
            return 1;
          })
      );
      break;

    case 'seed':
      setInstance(peekInstance());
      process.exit(
        await require('./seed')(args.slice(1))
          .then((code) => code)
          .catch((err) => {
            console.error(`\x1b[31m${err.message}\x1b[0m`);
            return 1;
          })
      );
      break;

    default:
      console.error(`Unknown command: ${command}`);
      usage(1);
  }
}

main().catch((err) => {
  console.error(`\x1b[31m${err.message}\x1b[0m`);
  if (process.env.ND_DEBUG === '1') console.error(err.stack);
  process.exit(1);
});
