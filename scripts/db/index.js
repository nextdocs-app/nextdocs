'use strict';

const fs = require('fs');
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
const containers = require('../lib/containers');
const instances = require('../lib/instance');
const flyway = require('../lib/flyway');
const prompt = require('../lib/prompt');
const { describeOwner } = require('../lib/lock');

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
 * A reset may only remove an attachment directory owned by this worktree. External
 * directories and linked parents must be kept explicitly with --keep-files.
 */
function assertSafeAttachmentDir(directory) {
  const resolved = path.resolve(directory);
  // Windows paths are case-insensitive.
  const key = (value) => (isWin ? value.toLowerCase() : value);
  const within = (parent, child) =>
    key(child) === key(parent) || key(child).startsWith(key(parent) + path.sep);
  const fail = (reason) => {
    throw new Error(
      `Refusing to delete attachment directory '${resolved}': ${reason}. ` +
        'Check ATTACHMENT_STORAGE_PATH.'
    );
  };

  const attachmentRoot = path.join(ROOT, 'api', 'data');
  if (!within(attachmentRoot, resolved) || key(resolved) === key(attachmentRoot)) {
    fail('only a directory under api/data is owned by this worktree; use --keep-files');
  }
  // rmSync follows symlinked parent components, even though it does not follow the final link.
  const relative = path.relative(ROOT, resolved).split(path.sep);
  let current = ROOT;
  for (const segment of relative.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail(`parent '${current}' is a symlink`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      break;
    }
  }
}

async function psqlCommand(argv) {
  const forwarded = argv[0] === '--' ? argv.slice(1) : argv;
  // `db psql` provisions the databases on a fresh worktree, so record them first: `db
  // prune` can only find a worktree's databases through its record.
  await refreshInstanceRecord();
  containers.ensurePostgres({ yhubSchema: false });
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

/**
 * Commands that provision databases write the instance record first. Without it, a
 * worktree that only ever ran `db reset` leaves databases no later `db prune` can find.
 * The record is re-resolved under the registry lock, never taken from the snapshot read
 * before a confirmation prompt: a start that happened meanwhile is in the file.
 */
async function refreshInstanceRecord(instance = getInstance()) {
  return instances.resolveInstance({ worktree: instance.worktree, env: {} });
}

async function statusCommand() {
  const postgresRunning = containers.containerRunning(POSTGRES_CONTAINER);
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
    apiDatabaseExists = containers.databaseExists(apiDatabase());
    yhubDatabaseExists = containers.databaseExists(yhubDatabase());
  } catch (err) {
    error(`Could not inspect Postgres: ${err.message}`);
    return 1;
  }

  if (apiDatabaseExists) {
    const state = flyway.migrationState();
    const flywayText = state.installed
      ? `Flyway ${state.applied} applied, ${state.pending} pending, ${state.failed} failed`
      : 'Flyway history not installed';
    lines.push(`${pad(apiDatabase(), width)}exists     ${flywayText}`);
  } else {
    lines.push(`${pad(apiDatabase(), width)}missing    run \`./nd db reset --yes\``);
  }

  let yhubText = 'database missing';
  if (yhubDatabaseExists) {
    yhubText = containers.tableExists(yhubDatabase(), 'yhub_ydoc_v1')
      ? 'schema initialized (yhub_ydoc_v1 present)'
      : 'schema not initialized';
  }
  lines.push(
    `${pad(yhubDatabase(), width)}${yhubDatabaseExists ? 'exists ' : 'missing'}    ${yhubText}`
  );

  if (containers.containerRunning(REDIS_CONTAINER)) {
    lines.push(
      `${pad('Redis', width)}${containers.redisPing() ? `running    PONG (prefix ${redisPrefix()})` : 'unhealthy  container is up but PING failed'}`
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

  const others = instances
    .listRecords(instance.registry)
    .filter((record) => record.id !== instance.id);
  if (others.length > 0) {
    console.log('');
    console.log('Other worktrees:');
    for (const record of others) {
      const state = instances.isWorktreePresent(record) ? 'recorded' : 'worktree missing';
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
  const confirmed = await prompt.confirmDestructive({
    headline: `This will drop all objects in this worktree's '${apiDatabase()}' database:`,
    details: [
      `database: ${apiDatabase()} (localhost:${POSTGRES_PORT}, container ${POSTGRES_CONTAINER})`,
      'left behind: the Yhub database, Redis state, attachment files',
    ],
    yes: hasFlag(argv, '--yes'),
  });
  if (!confirmed) return 1;

  warn(`Dropping objects in '${apiDatabase()}' only; Yhub content and Redis state survive.`);
  const status = flyway.runFlyway('clean', { clean: true, local: true });
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
  flyway.requireLocalPostgres();
}

/**
 * Why this instance's stack must not be reset right now. The ports come from the record:
 * `NEXTDOCS_API_URL` can be sourced from another worktree's `.nd/instance.env`, and
 * probing that URL would check a different stack than the one being dropped.
 */
async function runningStackReasons(instance) {
  const apiUrl = `http://localhost:${instance.ports.api}`;
  const realtimeUrl = `http://localhost:${instance.ports.realtime}`;
  const [apiUp, realtimeUp] = await Promise.all([
    fetchStatus(`${apiUrl}/api/v1/instance/status`),
    fetchStatus(`${realtimeUrl}/api/ping/v1`),
  ]);
  const supervisors = instances.liveSupervisors(instance);
  const pids = instances.liveServicePids(instance);
  return [
    apiUp ? `the API on ${apiUrl} answers` : null,
    realtimeUp ? `realtime on ${realtimeUrl} answers` : null,
    supervisors.length > 0
      ? `a foreground supervisor is running (${supervisors.map((entry) => entry.pid).join(', ')})`
      : null,
    Object.keys(pids).length > 0
      ? `detached services are running (${Object.keys(pids).join(', ')})`
      : null,
  ].filter(Boolean);
}

function refuseRunningStack(instance, reasons) {
  error(
    `Refusing to reset instance '${instance.id}': ${reasons.join(', ')}. ` +
      'Stop the stack first (`./nd stop`), then run this again (dropping a database ' +
      'under a live connection pool and flushing its Redis keyspace produces ' +
      'confusing reconnect errors).'
  );
}

async function resetCommand(argv) {
  if (hasFlag(argv, '--help')) {
    console.log(`Usage: ./nd db reset --yes [--keep-files]

Drops and recreates this worktree's two databases (${apiDatabase()} and
${yhubDatabase()}), re-initializes the Yhub schema, deletes this worktree's Redis
prefix (${redisPrefix()}), and removes its attachment files. Other worktrees are
untouched. The stack must be stopped: run this where \`./nd dev\` is not running, or
stop it first with \`./nd stop\` (the API and realtime both hold connections to the
databases this resets).

The reset claims this worktree for its whole duration, so a \`./nd dev\`/\`./nd up\`
that starts after the confirmation refuses or waits instead of racing the drops.
Everything that can fail (local Flyway environment, Redis, the Yhub initializer) is
checked before the first database is dropped.`);
    return 0;
  }

  // Both databases are reset below, so both targets have to be local before anything is
  // dropped: validating them one at a time would already have removed the first.
  assertLocalDatabase('db reset', { includeYhub: true });
  const instance = getInstance();

  // Cheap refusal before the prompt; the same check runs again under the claim. A linked
  // worktree without a record was never started here, so another worktree's API on the
  // default port must not block its reset (the record created below gets free ports).
  if (instance.hasRecord || instance.isMain) {
    const early = await runningStackReasons(instance);
    if (early.length > 0) {
      refuseRunningStack(instance, early);
      return 1;
    }
  }

  const keepFiles = hasFlag(argv, '--keep-files');
  const storage = attachmentStoragePath();
  if (!keepFiles) assertSafeAttachmentDir(storage);
  const confirmed = await prompt.confirmDestructive({
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

  // Confirmation is only a decision: the claim is what makes it safe. A start that won
  // the race is visible in the record and on this instance's ports below; a start that
  // arrives later waits for this claim to be released.
  const claim = await instances.claimInstance(instance, { waitMs: 0, label: 'db reset' });
  if (!claim) {
    const holder = instances.instanceClaimOwner(instance);
    error(
      `Refusing to reset instance '${instance.id}': ${describeOwner(holder)} owns this ` +
        'worktree right now (a start or another reset). Retry when it finishes.'
    );
    return 1;
  }
  try {
    return await resetClaimed(instance, { keepFiles, storage });
  } finally {
    instances.releaseInstanceClaim(claim);
  }
}

async function resetClaimed(initial, { keepFiles, storage }) {
  // Persist the record before provisioning: a worktree that only ever runs `db reset`
  // still creates databases, and `db prune` can only find them through a record.
  const instance = await refreshInstanceRecord(initial);

  // Recheck after acquiring the claim. The first check only saw what the prompt-time
  // record said; a start that began in between is recorded by now.
  const reasons = await runningStackReasons(instance);
  if (reasons.length > 0) {
    refuseRunningStack(instance, reasons);
    return 1;
  }

  // Everything that can fail without a database is validated first. A failure here
  // leaves both databases intact rather than stranding the API database empty.
  flyway.flywayEnv({ local: true }); // inherited -Dflyway.* options would retarget it
  containers.yhubInitializerPath(); // throws when @y/hub is not installed
  containers.ensurePostgres({ yhubSchema: false, local: true });
  // Redis must be ready before the keys are flushed, not after the databases are gone.
  containers.ensureRedis();

  info(`\x1b[34m> Recreating ${instance.database} and ${instance.yhubDatabase}...\x1b[0m`);
  containers.dropDatabase(instance.database);
  containers.dropDatabase(instance.yhubDatabase);
  containers.ensureDatabases({ yhubSchema: true, local: true });

  let redisFailure = null;
  try {
    const removed = containers.redisFlushPrefix(instance.redisPrefix);
    success(
      removed === 0
        ? `No Redis keys under '${instance.redisPrefix}'; nothing to delete.`
        : `Deleted ${removed} Redis keys under '${instance.redisPrefix}'.`
    );
  } catch (err) {
    redisFailure = err;
    error(`${err.message} Stale Yhub room state may survive this reset.`);
  }

  let attachmentFailure = null;
  if (keepFiles) {
    warn(`Attachment files kept at ${storage}.`);
  } else if (fs.existsSync(storage)) {
    try {
      fs.rmSync(storage, { recursive: true, force: true });
      success(`Removed attachment files at ${storage}.`);
    } catch (err) {
      // Reported at the end: a file that cannot be deleted must not skip the migration
      // that makes the databases usable again.
      attachmentFailure = err;
      error(`Could not remove attachment files at ${storage}: ${err.message}`);
    }
  } else {
    info(`No attachment directory at ${storage}; nothing to remove.`);
  }

  const migrateStatus = flyway.runFlyway('migrate', { local: true });
  if (migrateStatus !== 0) return migrateStatus;

  const state = flyway.migrationState(instance.database);
  if (!state.installed || state.pending !== 0 || state.failed !== 0) {
    error(
      `Flyway did not settle: ${state.applied} applied, ${state.pending} pending, ` +
        `${state.failed} failed. Run \`./nd db info\` for detail.`
    );
    return 1;
  }

  // The databases are usable at this point, so the remaining failures are reported last
  // rather than aborting earlier; reporting success with Yhub still holding rooms for the
  // databases that were just dropped is the one outcome that cannot be allowed.
  if (redisFailure) {
    error(
      `Reset finished with stale Redis state: ${redisFailure.message} ` +
        'Yhub may still hold rooms for the databases that were dropped.'
    );
    return 1;
  }
  if (attachmentFailure) {
    error(
      `Reset finished, but attachment files at ${storage} were not removed: ` +
        `${attachmentFailure.message}`
    );
    return 1;
  }

  success(
    `Reset complete: ${instance.database} at Flyway ${state.latest}, ` +
      `${instance.yhubDatabase} initialized.`
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
  const status = flyway.runFlyway('repair', { local: true });
  if (status === 0) success('Flyway history repaired.');
  return status;
}

/**
 * Prune one stale record. Ownership is a claim inside the record itself, taken under the
 * registry lock: `resolveInstance` refuses to adopt a claimed record, so a worktree
 * recreated after the confirmation cannot start against databases being dropped and a
 * later run re-reads the record instead of trusting the pre-prompt snapshot.
 */
async function pruneRecord(registry, expected) {
  const claimed = await instances.withRegistryLock(registry, () =>
    instances.claimStaleRecord(registry, expected)
  );
  if (!claimed) {
    return { pruned: false, reason: 'its worktree or record changed after confirmation' };
  }

  const problem = instances.recordMetadataProblem(claimed);
  if (problem) {
    // Invalid metadata is never repaired by deleting something: the record is the only
    // place these names are written down.
    await instances.withRegistryLock(registry, () =>
      instances.finishPruneClaim(registry, claimed.id, claimed.prune.token, { remove: false })
    );
    return { pruned: false, reason: `invalid record: ${problem}` };
  }
  if (instances.isWorktreePresent(claimed)) {
    await instances.withRegistryLock(registry, () =>
      instances.finishPruneClaim(registry, claimed.id, claimed.prune.token, { remove: false })
    );
    return { pruned: false, reason: 'its worktree was restored' };
  }

  let incomplete = false;
  const fail = (message) => {
    incomplete = true;
    warn(message);
  };
  try {
    for (const database of [claimed.database, claimed.yhubDatabase]) {
      try {
        containers.dropDatabase(database);
      } catch (err) {
        fail(`Could not drop ${database}: ${err.message}`);
      }
    }
    if (containers.containerRunning(REDIS_CONTAINER)) {
      try {
        containers.redisFlushPrefix(claimed.redisPrefix);
      } catch (err) {
        fail(`Could not clear Redis prefix ${claimed.redisPrefix}: ${err.message}`);
      }
    } else {
      fail(`Redis is not running; prefix ${claimed.redisPrefix} was not cleared.`);
    }
  } finally {
    // Keep the record when anything failed: the drops use IF EXISTS, so the record is
    // what lets a later prune finish the cleanup.
    await instances.withRegistryLock(registry, () =>
      instances.finishPruneClaim(registry, claimed.id, claimed.prune.token, {
        remove: !incomplete,
      })
    );
  }

  return {
    pruned: !incomplete,
    reason: incomplete ? 'cleanup did not finish' : null,
  };
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
  const stale = instances
    .listRecords(instance.registry)
    .filter((record) => record.id !== 'main' && !instances.isWorktreePresent(record));

  if (stale.length === 0) {
    success('No stale worktree databases to prune.');
    return 0;
  }

  const confirmed = await prompt.confirmDestructive({
    headline: 'This will drop the databases of worktrees that no longer exist:',
    details: stale.map((record) => `${record.id}: ${record.database} + ${record.yhubDatabase}`),
    yes: hasFlag(argv, '--yes'),
  });
  if (!confirmed) return 1;

  let retained = 0;
  for (const record of stale) {
    let outcome;
    try {
      outcome = await pruneRecord(instance.registry, record);
    } catch (err) {
      outcome = { pruned: false, reason: err.message };
    }
    if (outcome.pruned) {
      success(`Pruned ${record.id} (${record.database}, ${record.yhubDatabase}).`);
    } else {
      retained += 1;
      warn(`Kept ${record.id}: ${outcome.reason}.`);
    }
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
      return flyway.runFlyway('info');
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
      return flyway.runFlyway('migrate', { local: true });
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
      return flyway.runFlyway('validate', { local: true });
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
// Exposed for the script tests: they drive the destructive ordering with stubbed
// containers instead of a Docker host.
module.exports.resetCommand = resetCommand;
module.exports.pruneCommand = pruneCommand;
module.exports.assertSafeAttachmentDir = assertSafeAttachmentDir;
module.exports.runningStackReasons = runningStackReasons;
