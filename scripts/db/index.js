'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const { ROOT, info, success, warn, error, runSilent } = require('../lib/proc');
const {
  POSTGRES_CONTAINER,
  POSTGRES_PORT,
  POSTGRES_USER,
  REDIS_CONTAINER,
  apiDatabase,
  yhubDatabase,
  redisPrefix,
  apiBaseUrl,
  realtimeBaseUrl,
  webBaseUrl,
  postgresUrl,
  yhubPostgresUrl,
  attachmentStoragePath,
  assertLocalDatabase,
  getInstance,
} = require('../lib/constants');
const {
  ensurePostgres,
  ensureDatabases,
  ensureRedis,
  containerRunning,
  databaseExists,
  tableExists,
  redisPing,
  redisFlushPrefix,
  dropDatabase,
} = require('../lib/containers');
const {
  listRecords,
  isWorktreePresent,
  liveServicePids,
  removeRecord,
} = require('../lib/instance');
const { runFlyway, migrationState, requireLocalPostgres } = require('../lib/flyway');
const { confirmDestructive } = require('../lib/prompt');

const DB_USAGE = `Usage: ./nd db [command]

Commands:
  (none), psql [-- <args>]   Open the psql shell for this worktree's database
  status                     Containers, databases, Flyway, Redis, services, attachments
  info                       Flyway info (applied / pending / failed)
  migrate                    Apply pending Flyway migrations
  validate                   Validate applied migrations against the files
  repair                     Local recovery only: clear failed rows / accept checksums
  url [--show-password]      Print effective connection URLs (password masked by default)
  clean --yes                Drop objects in this worktree's database only
  reset --yes [--keep-files] Full reset of this worktree: its two databases, Redis prefix,
                             attachment files. Other worktrees are untouched.
  prune                      Drop databases of worktrees that no longer exist
  seed [profile]             Alias of ./nd seed

Run ./nd db <command> --help for the notes on a specific command.`;

function displayArg(value) {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(value) ? value : JSON.stringify(value);
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

/** Whether a local service answers within a bounded timeout; a missing service is not an error. */
async function fetchStatus(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

function maskPassword(url) {
  // The URL can be an exported SPRING_DATASOURCE_URL/POSTGRES, so cover both the libpq
  // userinfo form and the `?password=` parameter pgJDBC accepts.
  return String(url)
    .replace(/^(postgres(?:ql)?:\/\/[^:/@]+:)([^@]*)@/i, '$1***@')
    .replace(/([?&]password=)[^&]*/gi, '$1***');
}

function countFiles(directory) {
  let count = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(current, entry.name));
      else if (entry.isFile()) count += 1;
    }
  };
  walk(directory);
  return count;
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function instanceLine() {
  const instance = getInstance();
  return `${pad('Instance', 15)}${instance.id} (${instance.worktree})`;
}

/**
 * A reset deletes the attachment tree recursively, so a path that only looks dedicated is
 * not enough. `ATTACHMENT_STORAGE_PATH=.` resolves to `api/` — a null check passes and the
 * reset then deletes the API module — so a directory inside the checkout has to be under
 * `api/data`, and nothing may name the checkout or a directory that contains it.
 */
function assertSafeAttachmentDir(directory) {
  const resolved = path.resolve(directory);
  const segments = resolved.split(path.sep).filter(Boolean);
  // Windows paths are case-insensitive; a differently-cased home/root path must still
  // be rejected before `db reset` calls rmSync on it.
  const key = (value) => (isWin ? value.toLowerCase() : value);
  const within = (parent, child) =>
    key(child) === key(parent) || key(child).startsWith(key(parent) + path.sep);
  const fail = (reason) => {
    throw new Error(
      `Refusing to delete attachment directory '${resolved}': ${reason}. ` +
        'Check ATTACHMENT_STORAGE_PATH.'
    );
  };

  if (
    key(resolved) === key(path.parse(resolved).root) ||
    key(resolved) === key(os.homedir()) ||
    segments.length < 2
  ) {
    fail('it resolves to the filesystem root, the home directory, or a top-level path');
  }

  const attachmentRoot = path.join(ROOT, 'api', 'data');
  if (within(resolved, ROOT) || within(resolved, attachmentRoot)) {
    fail('it is the checkout or a directory that contains it');
  }
  if (within(ROOT, resolved) && !within(attachmentRoot, resolved)) {
    fail(`it is inside the checkout but outside ${path.relative(ROOT, attachmentRoot)}`);
  }
}

async function psqlCommand(argv) {
  const forwarded = argv[0] === '--' ? argv.slice(1) : argv;
  ensurePostgres({ yhubSchema: false });
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  // Pass argv as an array, not through a shell: single-quote escaping is not valid
  // cmd.exe quoting, and psql arguments can contain spaces (for example -c 'SQL').
  const args = [
    'exec',
    interactive ? '-it' : '-i',
    POSTGRES_CONTAINER,
    'psql',
    '-U',
    POSTGRES_USER,
    '-d',
    apiDatabase(),
    ...forwarded,
  ];
  console.log(`\x1b[34m> docker ${args.map(displayArg).join(' ')}\x1b[0m`);
  const result = require('child_process').spawnSync('docker', args, {
    stdio: 'inherit',
    cwd: ROOT,
  });
  return result.status === null ? 1 : result.status;
}

async function statusCommand() {
  const postgresRunning = containerRunning(POSTGRES_CONTAINER);
  if (!postgresRunning) {
    console.log(`${pad('Postgres', 15)}stopped    ${POSTGRES_CONTAINER}`);
    error('Postgres is not reachable; run `./nd dev` (or `./nd db reset --yes`).');
    return 1;
  }

  const instance = getInstance();
  // Instance database names can be longer than the old fixed labels; pad to fit them
  // so `nameexists` never runs together.
  const width = Math.max(15, apiDatabase().length + 2, yhubDatabase().length + 2);
  const lines = [
    instanceLine(),
    `${pad('Postgres', width)}running    localhost:${POSTGRES_PORT} (${POSTGRES_CONTAINER})`,
  ];

  let apiDatabaseExists;
  let yhubDatabaseExists;
  try {
    apiDatabaseExists = databaseExists(apiDatabase());
    yhubDatabaseExists = databaseExists(yhubDatabase());
  } catch (err) {
    error(`Could not inspect Postgres: ${err.message}`);
    return 1;
  }

  if (apiDatabaseExists) {
    const flyway = migrationState();
    const flywayText = flyway.installed
      ? `Flyway ${flyway.applied} applied, ${flyway.pending} pending, ${flyway.failed} failed`
      : 'Flyway history not installed';
    lines.push(`${pad(apiDatabase(), width)}exists     ${flywayText}`);
  } else {
    lines.push(`${pad(apiDatabase(), width)}missing    run \`./nd db reset --yes\``);
  }

  let yhubText = 'database missing';
  if (yhubDatabaseExists) {
    yhubText = tableExists(yhubDatabase(), 'yhub_ydoc_v1')
      ? 'schema initialized (yhub_ydoc_v1 present)'
      : 'schema not initialized';
  }
  lines.push(
    `${pad(yhubDatabase(), width)}${yhubDatabaseExists ? 'exists ' : 'missing'}    ${yhubText}`
  );

  if (containerRunning(REDIS_CONTAINER)) {
    lines.push(
      `${pad('Redis', width)}${redisPing() ? `running    PONG (prefix ${redisPrefix()})` : 'unhealthy  container is up but PING failed'}`
    );
  } else {
    lines.push(`${pad('Redis', width)}stopped    ${REDIS_CONTAINER}`);
  }

  const apiUrl = `${apiBaseUrl()}/api/v1/instance/status`;
  lines.push(
    `${pad('API', width)}${(await fetchStatus(apiUrl)) ? `healthy    ${apiBaseUrl()}` : 'unreachable'}`
  );
  lines.push(
    `${pad('Realtime', width)}${(await fetchStatus(`${realtimeBaseUrl()}/api/ping/v1`)) ? `healthy    ${realtimeBaseUrl()}` : 'unreachable'}`
  );

  const storage = attachmentStoragePath();
  lines.push(`${pad('Attachments', width)}         ${countFiles(storage)} files (${storage})`);

  for (const line of lines) console.log(line);

  const others = listRecords(instance.registry).filter((record) => record.id !== instance.id);
  if (others.length > 0) {
    console.log('');
    console.log('Other worktrees:');
    for (const record of others) {
      const state = isWorktreePresent(record) ? 'recorded' : 'worktree missing';
      console.log(
        `  ${pad(record.id, 24)} web :${record.ports.web}  api :${record.ports.api}  ${state}`
      );
    }
    console.log('Run `./nd status` for the full table.');
  }
  return 0;
}

function urlCommand(argv) {
  const showPassword = hasFlag(argv, '--show-password');
  const render = (url) => (showPassword ? url : maskPassword(url));
  const instance = getInstance();
  console.log(`${pad('instance', 12)} ${instance.id} (${instance.worktree})`);
  console.log(`${pad('nextdocs', 12)} ${render(postgresUrl())}`);
  console.log(`${pad('yhub', 12)} ${render(yhubPostgresUrl())}`);
  console.log(`${pad('api', 12)} ${apiBaseUrl()}`);
  console.log(`${pad('realtime', 12)} ${realtimeBaseUrl()}`);
  console.log(`${pad('web', 12)} ${webBaseUrl()}`);
  console.log(`${pad('redis prefix', 12)} ${redisPrefix()}`);
  console.log(`${pad('attachments', 12)} ${attachmentStoragePath()}`);
  return 0;
}

async function cleanCommand(argv) {
  if (hasFlag(argv, '--help')) {
    console.log(`Usage: ./nd db clean --yes

Drops objects in this worktree's ${apiDatabase()} database only. Yhub rooms, Yhub
tombstones, Redis state, and attachment files are left behind. For a re-seedable
state use \`./nd db reset --yes\` (Yhub tombstones make ids unusable).`);
    return 0;
  }
  requireLocalDatabase('db clean');
  const confirmed = await confirmDestructive({
    headline: `This will drop all objects in this worktree's '${apiDatabase()}' database:`,
    details: [
      `database: ${apiDatabase()} (localhost:${POSTGRES_PORT}, container ${POSTGRES_CONTAINER})`,
      'left behind: the Yhub database, Redis state, attachment files',
    ],
    yes: hasFlag(argv, '--yes'),
  });
  if (!confirmed) return 1;

  warn(`Dropping objects in '${apiDatabase()}' only; Yhub content and Redis state survive.`);
  const status = runFlyway('clean', { clean: true, local: true });
  if (status !== 0) return status;
  success(`'${apiDatabase()}' is empty. Run \`./nd db migrate\` to rebuild the schema.`);
  console.log(
    'For a re-seedable state use `./nd db reset --yes` (Yhub tombstones make ids unusable).'
  );
  return 0;
}

/** The container is the local server these commands are allowed to touch. */
function requireLocalDatabase(action, options) {
  assertLocalDatabase(action, options);
  requireLocalPostgres();
}

async function apiIsRunning() {
  return fetchStatus(`${apiBaseUrl()}/api/v1/instance/status`);
}

/** Realtime holds its own pool against the Yhub database and its Redis keyspace. */
async function realtimeIsRunning() {
  return fetchStatus(`${realtimeBaseUrl()}/api/ping/v1`);
}

async function resetCommand(argv) {
  if (hasFlag(argv, '--help')) {
    console.log(`Usage: ./nd db reset --yes [--keep-files]

Drops and recreates this worktree's two databases (${apiDatabase()} and
${yhubDatabase()}), re-initializes the Yhub schema, deletes this worktree's Redis
prefix (${redisPrefix()}), and removes its attachment files. Other worktrees are
untouched. The stack must be stopped: run this where \`./nd dev\` is not running, or
stop it first with \`./nd stop\` (the API and realtime both hold connections to the
databases this resets).`);
    return 0;
  }

  // Both databases are reset below, so both targets have to be local before anything is
  // dropped: validating them one at a time would already have removed the first.
  assertLocalDatabase('db reset', { includeYhub: true });
  const instance = getInstance();

  // A linked worktree without a record was never started here, so another worktree's
  // API on the same port must not block its reset. The main worktree keeps the
  // historical names and may still be served by a stack started before instances
  // existed, so it always gets the check.
  if (instance.hasRecord || instance.isMain) {
    const apiUp = await apiIsRunning();
    const realtimeUp = await realtimeIsRunning();
    // HTTP alone misses the window between spawn and first answer, which is most of a
    // cold start. The record already knows: a foreground supervisor is claimed before
    // its children bind, and `./nd up` publishes pids before it waits for readiness.
    const pids = liveServicePids(instance);
    const reasons = [
      apiUp ? `the API on ${apiBaseUrl()} answers` : null,
      realtimeUp ? `realtime on ${realtimeBaseUrl()} answers` : null,
      instance.running ? 'the foreground supervisor is running' : null,
      Object.keys(pids).length > 0
        ? `detached services are running (${Object.keys(pids).join(', ')})`
        : null,
    ].filter(Boolean);
    if (reasons.length > 0) {
      error(
        `Refusing to reset instance '${instance.id}': ${reasons.join(', ')}. ` +
          'Stop the stack first (`./nd stop`), then run this again (dropping a database ' +
          'under a live connection pool and flushing its Redis keyspace produces ' +
          'confusing reconnect errors).'
      );
      return 1;
    }
  }

  const keepFiles = hasFlag(argv, '--keep-files');
  const storage = attachmentStoragePath();
  if (!keepFiles) assertSafeAttachmentDir(storage);
  const confirmed = await confirmDestructive({
    headline: `This will permanently delete this worktree's local data (${instance.id}):`,
    details: [
      `database: ${apiDatabase()} (localhost:${POSTGRES_PORT}, container ${POSTGRES_CONTAINER})`,
      `database: ${yhubDatabase()} (same container; Yhub rooms and tombstones)`,
      `Redis: keys with prefix '${redisPrefix()}' in ${REDIS_CONTAINER}`,
      keepFiles ? `attachment files: kept (${storage})` : `attachment files: ${storage}`,
      'other worktrees: untouched',
    ],
    yes: hasFlag(argv, '--yes'),
  });
  if (!confirmed) return 1;

  // `local` on every step below: the prompt names this worktree's databases, so the
  // database that gets dropped, initialized and migrated has to be those same ones even
  // when the shell exports SPRING_DATASOURCE_URL or POSTGRES for another stack.
  ensurePostgres({ yhubSchema: false, local: true });

  info(`\x1b[34m> Recreating ${apiDatabase()} and ${yhubDatabase()}...\x1b[0m`);
  dropDatabase(apiDatabase());
  dropDatabase(yhubDatabase());
  ensureDatabases({ yhubSchema: true, local: true });

  ensureRedis();
  let redisFailure = null;
  try {
    const removed = redisFlushPrefix();
    success(
      removed === 0
        ? `No Redis keys under '${redisPrefix()}'; nothing to delete.`
        : `Deleted ${removed} Redis keys under '${redisPrefix()}'.`
    );
  } catch (err) {
    redisFailure = err;
    error(`${err.message} Stale Yhub room state may survive this reset.`);
  }

  if (keepFiles) {
    warn(`Attachment files kept at ${storage}.`);
  } else if (fs.existsSync(storage)) {
    fs.rmSync(storage, { recursive: true, force: true });
    success(`Removed attachment files at ${storage}.`);
  } else {
    info(`No attachment directory at ${storage}; nothing to remove.`);
  }

  const migrateStatus = runFlyway('migrate', { local: true });
  if (migrateStatus !== 0) return migrateStatus;

  const flyway = migrationState();
  if (!flyway.installed || flyway.pending !== 0 || flyway.failed !== 0) {
    error(
      `Flyway did not settle: ${flyway.applied} applied, ${flyway.pending} pending, ` +
        `${flyway.failed} failed. Run \`./nd db info\` for detail.`
    );
    return 1;
  }

  // The databases are usable at this point, so the failure is reported last rather than
  // aborting earlier; reporting success with Yhub still holding rooms for the databases
  // that were just dropped is the one outcome that cannot be allowed.
  if (redisFailure) {
    error(
      `Reset finished with stale Redis state: ${redisFailure.message} ` +
        'Yhub may still hold rooms for the databases that were dropped.'
    );
    return 1;
  }

  success(
    `Reset complete: ${apiDatabase()} at Flyway ${flyway.latest}, ${yhubDatabase()} initialized.`
  );
  console.log('');
  console.log('Next:');
  console.log('  ./nd dev        # start api + web + realtime');
  console.log('  ./nd seed       # in another terminal, after the API is healthy');
  return 0;
}

function repairCommand(argv) {
  if (hasFlag(argv, '--help')) {
    console.log(`Usage: ./nd db repair

Local recovery only. Removes failed history rows and accepts checksum changes for
already-applied migrations. Never run this against a shared database.`);
    return 0;
  }
  requireLocalDatabase('db repair');
  warn(
    'db repair is a local recovery tool. It removes failed history rows and accepts ' +
      'checksum changes; never run it against a shared database.'
  );
  const status = runFlyway('repair');
  if (status === 0) success('Flyway history repaired.');
  return status;
}

async function pruneCommand(argv) {
  if (hasFlag(argv, '--help')) {
    console.log(`Usage: ./nd db prune [--yes]

Drops the databases of worktrees that no longer exist. The main worktree and any
worktree that still exists are never touched.`);
    return 0;
  }

  requireLocalDatabase('db prune');
  const instance = getInstance();
  const stale = listRecords(instance.registry).filter(
    (record) => record.id !== 'main' && !isWorktreePresent(record)
  );

  if (stale.length === 0) {
    success('No stale worktree databases to prune.');
    return 0;
  }

  const confirmed = await confirmDestructive({
    headline: 'This will drop the databases of worktrees that no longer exist:',
    details: stale.map((record) => `${record.id}: ${record.database} + ${record.yhubDatabase}`),
    yes: hasFlag(argv, '--yes'),
  });
  if (!confirmed) return 1;

  let retained = 0;
  for (const record of stale) {
    let incomplete = false;
    const fail = (message) => {
      incomplete = true;
      warn(message);
    };

    // A worktree can vanish while its stack is still shutting down.
    try {
      dropDatabase(record.database);
    } catch (err) {
      fail(`Could not drop ${record.database}: ${err.message}`);
    }
    try {
      dropDatabase(record.yhubDatabase);
    } catch (err) {
      fail(`Could not drop ${record.yhubDatabase}: ${err.message}`);
    }
    if (containerRunning(REDIS_CONTAINER)) {
      try {
        redisFlushPrefix(record.redisPrefix);
      } catch (err) {
        fail(`Could not clear Redis prefix ${record.redisPrefix}: ${err.message}`);
      }
    } else {
      fail(`Redis is not running; prefix ${record.redisPrefix} was not cleared.`);
    }

    if (incomplete) {
      // The record is the only place these names are written down, and the drops use
      // IF EXISTS: keeping it is what lets a later prune finish the cleanup.
      retained += 1;
      continue;
    }
    removeRecord(instance.registry, record.id);
    success(`Pruned ${record.id} (${record.database}, ${record.yhubDatabase}).`);
  }

  if (retained > 0) {
    error(
      `${retained} stale record(s) kept so the cleanup can be retried; start Redis ` +
        'with `./nd dev` (or `./nd up`) and run this again.'
    );
    return 1;
  }
  return 0;
}

async function main(argv) {
  const command = argv[0];

  if (!command) {
    return psqlCommand([]);
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(DB_USAGE);
    return 0;
  }

  switch (command) {
    case 'psql':
      if (hasFlag(argv, '--help')) {
        console.log(`Usage: ./nd db psql [-- <psql args>]\n\nOpens psql for ${apiDatabase()}.`);
        return 0;
      }
      return psqlCommand(argv.slice(1));
    case 'status':
      return statusCommand();
    case 'url':
      if (hasFlag(argv, '--help')) {
        console.log(
          'Usage: ./nd db url [--show-password]\n\nPrints connection URLs. Passwords are masked by default.'
        );
        return 0;
      }
      return urlCommand(argv);
    case 'info':
      if (hasFlag(argv, '--help')) {
        console.log(
          'Usage: ./nd db info\n\nFlyway info for the selected database: applied, pending ' +
            'and failed migrations. `db url` shows which database that is.'
        );
        return 0;
      }
      // `flywayUrl()` prefers an exported `SPRING_DATASOURCE_URL`, so the container check
      // alone is not enough: without this a stray URL would apply schema changes to a
      // remote database while the command reported local-container health.
      requireLocalDatabase('db info');
      return runFlyway('info');
    case 'migrate':
      if (hasFlag(argv, '--help')) {
        console.log(
          "Usage: ./nd db migrate\n\nApplies pending Flyway migrations to this worktree's database."
        );
        return 0;
      }
      requireLocalDatabase('db migrate');
      // `local`: an inherited SPRING_DATASOURCE_URL can name another worktree's database,
      // and the help text promises this one.
      return runFlyway('migrate', { local: true });
    case 'validate':
      if (hasFlag(argv, '--help')) {
        console.log(
          "Usage: ./nd db validate\n\nValidates the migrations this worktree's database " +
            'has applied against the files on disk.'
        );
        return 0;
      }
      requireLocalDatabase('db validate');
      // Same target as `migrate`, so validating does not describe a different database.
      return runFlyway('validate', { local: true });
    case 'repair':
      return repairCommand(argv);
    case 'clean':
      return cleanCommand(argv);
    case 'reset':
      return resetCommand(argv);
    case 'prune':
      return pruneCommand(argv);
    case 'seed':
      return require('../seed')(argv.slice(1))
        .then((code) => code)
        .catch((err) => {
          error(err.message);
          return 1;
        });
    default:
      error(`Unknown db command: '${command}'`);
      console.log(DB_USAGE);
      return 1;
  }
}

module.exports = main;
