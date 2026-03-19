#!/usr/bin/env node

const { spawnSync, spawn } = require('child_process');
const { randomBytes } = require('crypto');
const path = require('path');

const args = process.argv.slice(2);
const fixIndex = args.indexOf('--fix');
const isFix = fixIndex !== -1;
if (isFix) args.splice(fixIndex, 1);

const command = args[0];
const service = args[1];

const ROOT = path.resolve(__dirname, '..');
const ALL_SERVICES = ['api', 'web', 'realtime'];

const isWin = process.platform === 'win32';
const mvnw = isWin ? 'mvnw.cmd' : './mvnw';

const POSTGRES_CONTAINER = 'nextdocs-postgres';
const POSTGRES_IMAGE = 'postgres:15-alpine';
const POSTGRES_PORT = '5433'; // 5432 is typically taken by a local PostgreSQL install
const POSTGRES_USER = 'nextdocs';
const POSTGRES_PASSWORD = 'nextdocs';
const POSTGRES_DB = 'nextdocs';

// TODO: If the number of keys that need to be generated this way are more,
// we may need to find a more generalizable pattern.
let generatedDevOAuthTokenKey = null;
let generatedDevJwtSecret = null;

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

const PLACEHOLDER = 'CHANGE_ME_IN_PRODUCTION';

function buildApiDevEnv(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
  };

  // Keep required API dev env defaults in one place so ./nd dev is zero-setup.
  const isKeyEmptyOrPlaceholder = (val) => !val || !val.trim() || val === PLACEHOLDER;

  if (isKeyEmptyOrPlaceholder(env.OAUTH_TOKEN_ENCRYPTION_KEY_BASE64)) {
    env.OAUTH_TOKEN_ENCRYPTION_KEY_BASE64 = getOrCreateDevOAuthTokenEncryptionKey();
    console.warn(
      '\x1b[33mWARNING: OAUTH_TOKEN_ENCRYPTION_KEY_BASE64 was not set. Using an ephemeral dev key for this ./nd session.\n'
      + '  Set OAUTH_TOKEN_ENCRYPTION_KEY_BASE64 for stable token decryption across restarts.\x1b[0m');
  }

  if (isKeyEmptyOrPlaceholder(env.JWT_SECRET)) {
    env.JWT_SECRET = getOrCreateDevJwtSecret();
    console.warn(
      '\x1b[33mWARNING: JWT_SECRET was not set. Using an ephemeral dev key for this ./nd session.\n'
      + '  Set JWT_SECRET for stable token validation across restarts.\x1b[0m');
  }

  return env;
}

function run(cmd, opts = {}) {
  console.log(`\x1b[34m> ${cmd}\x1b[0m`);
  const result = spawnSync(cmd, {
    stdio: 'inherit',
    shell: true,
    cwd: opts.cwd || ROOT,
    env: opts.env || process.env,
  });
  if (opts.exitOnError !== false && result.status !== 0) {
    process.exit(result.status);
  }
  return result.status;
}

function runSilent(cmd) {
  return spawnSync(cmd, { shell: true, cwd: ROOT, stdio: 'pipe' });
}

function turbo(task, filter, extraArgs = '') {
  const filterFlag = filter ? ` --filter=${filter}` : '';
  return run(`npx turbo run ${task}${filterFlag}${extraArgs}`);
}

function ensurePostgres() {
  // Check if container is already running
  const check = runSilent(`docker inspect -f "{{.State.Running}}" ${POSTGRES_CONTAINER}`);
  if (check.status === 0 && check.stdout.toString().trim() === 'true') {
    console.log(`\x1b[32m✓ Postgres already running\x1b[0m`);
    return;
  }

  // Check if container exists but is stopped
  const exists = runSilent(`docker inspect ${POSTGRES_CONTAINER}`);
  if (exists.status === 0) {
    console.log(`\x1b[34m> Starting existing postgres container...\x1b[0m`);
    run(`docker start ${POSTGRES_CONTAINER}`);
    return;
  }

  // Create and start a new container
  console.log(`\x1b[34m> Starting postgres...\x1b[0m`);
  run([
    'docker run -d',
    `--name ${POSTGRES_CONTAINER}`,
    `-p ${POSTGRES_PORT}:5432`,
    `-e POSTGRES_USER=${POSTGRES_USER}`,
    `-e POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
    `-e POSTGRES_DB=${POSTGRES_DB}`,
    `-v nextdocs_pgdata:/var/lib/postgresql/data`,
    POSTGRES_IMAGE,
  ].join(' '));
}

const API_COMMANDS = {
  lint: isFix
    ? `${mvnw} spotless:apply --no-transfer-progress`
    : `${mvnw} spotless:check --no-transfer-progress`,
  test: `${mvnw} test --no-transfer-progress`,
  build: `${mvnw} package -DskipTests --no-transfer-progress`,
  dev: `${mvnw} spring-boot:run`,
  format: `${mvnw} spotless:apply --no-transfer-progress`,
};

function usage() {
  console.log('Usage: ./nd <command> [service] [--fix]');
  console.log();
  console.log('Commands:');
  console.log('  dev [service]       Start dev servers (auto-starts postgres)');
  console.log('  lint [service]      Run linters (--fix to auto-fix)');
  console.log('  format [service]    Run formatters (--fix to auto-fix)');
  console.log('  test [service]      Run tests');
  console.log('  build [service]     Build packages');
  console.log('  db                  Open psql shell');
  console.log();
  console.log(`Services: ${ALL_SERVICES.join(', ')}`);
  console.log('Omit service to run across all.');
  process.exit(1);
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
    const opts = { cwd: path.join(ROOT, 'api') };
    if (task === 'dev') {
      opts.env = buildApiDevEnv();
    }
    return run(API_COMMANDS[task], opts);
  }
  return turbo(task, svc);
}

function runForAll(task) {
  console.log(`\n--- API ---`);
  const apiStatus = run(API_COMMANDS[task] || 'echo skipped', {
    cwd: path.join(ROOT, 'api'),
    exitOnError: false,
  });

  console.log(`\n--- WEB + REALTIME ---`);
  let turboTask = task;
  if (task === 'format' && isFix) turboTask = 'format:fix';
  const turboStatus = turbo(turboTask, null, (task === 'lint' && isFix) ? ' -- --fix' : '');

  if (apiStatus !== 0 || turboStatus !== 0) process.exit(1);
}

if (!command) usage();

switch (command) {
  case 'dev':
    // TODO: We will not require postgres to be running for web and realtime.
    ensurePostgres();
    if (service) {
      runForService('dev', service);
    } else {
      console.log('\x1b[34m> Starting all dev servers...\x1b[0m');
      const api = spawn(mvnw, ['spring-boot:run', '--no-transfer-progress'], {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true,
        cwd: path.join(ROOT, 'api'),
        env: {
          ...buildApiDevEnv(),
          SPRING_OUTPUT_ANSI_ENABLED: 'ALWAYS',
        }
      });
      const turboProc = spawn('npx', ['turbo', 'run', 'dev'], {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true,
        cwd: ROOT,
         env: {
          ...process.env,
          FORCE_COLOR: '1',
        }
      });

      // Pipe output manually so Node waits for the actual processes to close pipes
      api.stdout.pipe(process.stdout);
      api.stderr.pipe(process.stderr);
      turboProc.stdout.pipe(process.stdout);
      turboProc.stderr.pipe(process.stderr);

      let finalCode = 0;

      // Instead of waiting for the wrappers to exit, we wait for their output 
      // streams to close. This guarantees the actual background grandchild 
      // processes have gracefully shutdown before the script exits.
      let closedAPI = false;
      let closedTurbo = false;

      api.stdout.on('end', () => {
         closedAPI = true;
         if (closedTurbo) process.exit(finalCode);
      });

      turboProc.stdout.on('end', () => {
         closedTurbo = true;
         if (closedAPI) process.exit(finalCode);
      });

      api.on('exit', (code) => {
        if (code !== 0 && code !== null) finalCode = code;
      });

      turboProc.on('exit', (code) => {
        if (code !== 0 && code !== null) finalCode = code;
      });

      process.on('SIGINT', () => {
        if (isWin) {
          if (api.pid) runSilent(`taskkill /pid ${api.pid} /T /F`);
          if (turboProc.pid) runSilent(`taskkill /pid ${turboProc.pid} /T /F`);
        } else {
          try { if (api.pid) api.kill('SIGINT'); } catch (_) {}
          try { if (turboProc.pid) turboProc.kill('SIGINT'); } catch (_) {}
        }
        process.exit();
      });

      process.on('SIGTERM', () => {
        if (isWin) {
          runSilent(`taskkill /pid ${api.pid} /T /F`);
          runSilent(`taskkill /pid ${turboProc.pid} /T /F`);
        } else {
          api.kill('SIGTERM');
          turboProc.kill('SIGTERM');
        }
      });

      // Stop postgres when exiting dev mode
      process.on('exit', () => {
        console.log(`\x1b[34m> Stopping postgres container...\x1b[0m`);
        runSilent(`docker stop ${POSTGRES_CONTAINER}`);
      });
    }
    break;

  case 'lint':
    if (service) {
      validateService(service);
      if (service === 'api' && isFix) {
        run(`${mvnw} spotless:apply --no-transfer-progress`, { cwd: path.join(ROOT, 'api') });
      } else if (service === 'api') {
        run(`${mvnw} spotless:check --no-transfer-progress`, { cwd: path.join(ROOT, 'api') });
      } else {
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
    ensurePostgres();
    run(`docker exec -it ${POSTGRES_CONTAINER} psql -U ${POSTGRES_USER} -d ${POSTGRES_DB}`);
    break;

  default:
    console.error(`Unknown command: ${command}`);
    usage();
}
