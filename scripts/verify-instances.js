#!/usr/bin/env node

'use strict';

/**
 * Two-worktree integration check for the agent lifecycle.
 *
 * It copies the current working tree (including uncommitted changes) into two temp
 * worktrees, installs both, starts both stacks at once, and verifies isolation,
 * scoped reset/stop, crash reporting and recovery. Cleanup drops only the databases
 * and Redis prefixes created for these two worktrees; the main worktree's databases
 * and running stack are checked before and after.
 *
 * Usage: node scripts/verify-instances.js [--keep]
 * Requires: git, Node, Docker, and the shared Postgres/Redis/Mailpit containers.
 */

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, sleep } = require('./lib/proc');
const { POSTGRES_CONTAINER, POSTGRES_USER, REDIS_CONTAINER } = require('./lib/constants');
const { dropDatabase, redisFlushPrefix } = require('./lib/containers');
const { listRecords, liveServicePids, peekInstance, removeRecord } = require('./lib/instance');
const { acquireLock, releaseLock } = require('./lib/lock');
const { portOpen } = require('./lib/ports');

const isWin = process.platform === 'win32';
const BASE = path.join(ROOT, '.nd', 'verify-instances');
// The lock lives beside BASE, not inside it: cleanup removes BASE when both worktrees are
// gone, and a second verifier must still see that the first one owns the run.
const VERIFIER_LOCK = path.join(ROOT, '.nd', 'verify-instances.lock');
const AGENTS = [
  { name: 'agent-a', dir: path.join(BASE, 'agent-a') },
  { name: 'agent-b', dir: path.join(BASE, 'agent-b') },
];
const KEEP = process.argv.includes('--keep');
const MARKER_TABLE = 'nd_verify_marker';
const RUN_ID = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

function log(step) {
  console.log(`\n\x1b[36m▸ ${step}\x1b[0m`);
}

function warn(message) {
  console.warn(`\x1b[33m… ${message}\x1b[0m`);
}

function tail(text, lines = 25) {
  const content = String(text || '').trim();
  if (!content) return '(no output)';
  return content.split('\n').slice(-lines).join('\n');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout,
    env: process.env,
    shell: options.shell || false,
  });
  if (!options.allowFail && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (exit ${result.status}): ` +
        `${tail(result.stderr || result.stdout)}`
    );
  }
  return result;
}

function nd(args, options = {}) {
  const cwd = options.cwd || ROOT;
  // Run the JavaScript entry point directly: spawning nd.cmd from Node needs a shell on
  // Windows and makes argument quoting platform-specific. This exercises the same CLI.
  return run(process.execPath, [path.join(cwd, 'scripts', 'nd.js'), ...args], {
    ...options,
    cwd,
  });
}

function ndJson(args, options = {}) {
  const result = nd(args, { ...options, allowFail: true });
  assert.equal(
    result.status,
    0,
    `./nd ${args.join(' ')} failed (exit ${result.status}): ${tail(result.stderr || result.stdout)}`
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`./nd ${args.join(' ')} returned non-JSON stdout: ${tail(result.stdout)}`);
  }
}

function ndAsync(args, cwd, timeoutMs = 360_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(cwd, 'scripts', 'nd.js'), ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (isWin) {
        // Node's SIGTERM only ends the CLI; detached services are children of it.
        run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { allowFail: true });
      } else {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, signal: timedOut ? 'timeout' : null, stdout, stderr });
    });
  });
}

function psql(database, sql) {
  const result = run(
    'docker',
    [
      'exec',
      POSTGRES_CONTAINER,
      'psql',
      '-U',
      POSTGRES_USER,
      '-d',
      database,
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { allowFail: true }
  );
  assert.equal(
    result.status,
    0,
    `psql on ${database} failed: ${tail(result.stderr || result.stdout)}`
  );
  return result.stdout.trim();
}

function redisCli(args) {
  const result = run('docker', ['exec', REDIS_CONTAINER, 'redis-cli', ...args], {
    allowFail: true,
  });
  assert.equal(result.status, 0, `redis-cli failed: ${tail(result.stderr || result.stdout)}`);
  return result.stdout.trim();
}

function adminDatabases() {
  return psql('postgres', 'SELECT datname FROM pg_database ORDER BY 1')
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
}

async function mainStatuses() {
  return Promise.all(
    [3000, 8080, 1234].map(async (port) => {
      try {
        const res = await fetch(`http://localhost:${port}`, {
          signal: AbortSignal.timeout(2000),
        });
        return `${port}:${res.status}`;
      } catch {
        return `${port}:down`;
      }
    })
  );
}

function checkTools() {
  for (const command of ['git', 'docker']) {
    const result = run(command, ['--version'], { allowFail: true });
    assert.equal(
      result.status,
      0,
      `${command} is required for this check but was not found on PATH.`
    );
  }
  // npm is a .cmd shim on Windows, so resolve it through the platform shell.
  const npm = run('npm', ['--version'], { allowFail: true, shell: true });
  assert.equal(npm.status, 0, 'npm is required for this check but was not found on PATH.');
  const daemon = run('docker', ['info', '--format', '{{.ServerVersion}}'], { allowFail: true });
  assert.equal(
    daemon.status,
    0,
    'Docker is installed but the daemon is not reachable; start Docker first.'
  );

  const strayLockfiles = [
    path.join(ROOT, 'web', 'package-lock.json'),
    path.join(ROOT, 'realtime', 'package-lock.json'),
  ].filter((file) => fs.existsSync(file));
  assert.equal(
    strayLockfiles.length,
    0,
    `Remove ${strayLockfiles.map((file) => path.relative(ROOT, file)).join(', ')} before running this check.`
  );
}

function registryDir() {
  const common = run('git', ['rev-parse', '--git-common-dir'], {
    allowFail: true,
  }).stdout.trim();
  return path.resolve(ROOT, common, 'nextdocs', 'instances');
}

/**
 * Drop the databases and Redis prefix of one verification instance. Returns whether the
 * cleanup finished: the record is the only place these names are written down, so it is
 * kept when anything failed and a later run can retry.
 */
function dropInstance(instance) {
  let complete = true;
  for (const database of [instance.database, instance.yhubDatabase]) {
    try {
      dropDatabase(database);
    } catch (err) {
      complete = false;
      warn(`Could not drop ${database}: ${err.message}`);
    }
  }
  try {
    redisFlushPrefix(instance.redisPrefix);
  } catch (err) {
    complete = false;
    warn(`Could not clear Redis prefix ${instance.redisPrefix}: ${err.message}`);
  }
  if (!complete) {
    warn(`Keeping the instance record for ${instance.id} so the cleanup can be retried.`);
    return false;
  }
  removeRecord(instance.registry, instance.id);
  return true;
}

/**
 * Remove one verification worktree only after its stack is confirmed gone. A stop that
 * failed, a live pid or an open port leaves both the worktree and its record in place:
 * removing them would orphan running services and lose the only handle for a retry.
 */
async function cleanupWorktree(agent) {
  if (!fs.existsSync(agent.dir)) return;
  const instance = peekInstance({ worktree: agent.dir, env: {}, applyPins: false });

  const stopped = nd(['stop', '--json'], { cwd: agent.dir, allowFail: true, timeout: 60_000 });
  if (stopped.status !== 0) {
    warn(
      `Not removing ${agent.name}: ./nd stop failed (exit ${stopped.status}): ` +
        tail(stopped.stderr || stopped.stdout)
    );
    return;
  }
  // Only a recorded instance owns services and ports here; a worktree whose install failed
  // before `up` has none, and the main stack's default ports say nothing about it.
  if (instance.hasRecord) {
    const live = Object.keys(liveServicePids(instance));
    const openPorts = [];
    for (const [name, port] of Object.entries(instance.ports || {})) {
      if (await portOpen(port)) openPorts.push(`${name}:${port}`);
    }
    if (live.length > 0 || openPorts.length > 0) {
      warn(`Not removing ${agent.name}: still running (${[...live, ...openPorts].join(', ')}).`);
      return;
    }
  }

  const removed = run('git', ['worktree', 'remove', '--force', agent.dir], {
    allowFail: true,
  });
  if (removed.status !== 0) {
    warn(`Could not remove ${agent.dir}: ${tail(removed.stderr || removed.stdout)}`);
    return;
  }
  if (instance.hasRecord && instance.id !== 'main') {
    dropInstance(instance);
  }
}

function pruneVerificationRecords() {
  const registry = registryDir();
  const base = path.resolve(BASE);
  const prefix = isWin ? `${base}${path.sep}`.toLowerCase() : `${base}${path.sep}`;
  for (const record of listRecords(registry)) {
    const worktree = path.resolve(record.worktree || '');
    const comparable = isWin ? worktree.toLowerCase() : worktree;
    if (!comparable.startsWith(prefix)) continue;
    if (fs.existsSync(worktree)) continue;
    if (record.id !== 'main') dropInstance({ ...record, registry });
  }
}

async function cleanupAll() {
  log('Cleaning up verification worktrees');
  for (const agent of AGENTS) {
    await cleanupWorktree(agent);
  }
  run('git', ['worktree', 'prune'], { allowFail: true });
  pruneVerificationRecords();

  if (AGENTS.every((agent) => !fs.existsSync(agent.dir))) {
    fs.rmSync(BASE, { recursive: true, force: true });
  }
}

function setupWorktrees() {
  log('Creating two worktrees from the current working tree');
  fs.mkdirSync(BASE, { recursive: true });
  const excludes = new Set([
    'node_modules',
    '.git',
    '.next',
    '.nd',
    'target',
    '.turbo',
    'coverage',
    '.env',
    '.dev.vars',
  ]);

  for (const agent of AGENTS) {
    run('git', ['worktree', 'add', '--detach', agent.dir, 'HEAD']);
    // Copy with Node rather than rsync so the check works on Windows too. Copy each
    // top-level entry instead of ROOT itself: Node refuses a whole-tree copy into a
    // subdirectory of the source, and this worktree lives under ROOT/.nd. The .git
    // entry in a linked worktree is a file; excluding it preserves the worktree link.
    for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (excludes.has(entry.name)) continue;
      fs.cpSync(path.join(ROOT, entry.name), path.join(agent.dir, entry.name), {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
        filter: (source) => {
          const relative = path.relative(ROOT, source);
          return !relative.split(path.sep).some((part) => excludes.has(part));
        },
      });
    }
    assert.ok(
      fs.existsSync(path.join(agent.dir, 'scripts', 'nd.js')),
      `${agent.name} worktree is missing scripts/nd.js`
    );
  }
}

async function installWorktrees() {
  log('Installing both worktrees (npm ci)');
  const results = await Promise.all(
    AGENTS.map(
      (agent) =>
        new Promise((resolve) => {
          const child = spawn('npm', ['ci', '--no-audit', '--no-fund'], {
            cwd: agent.dir,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            // npm is npm.cmd on Windows; a shell resolves it on both platforms.
            shell: true,
          });
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('error', (err) => resolve({ agent, code: 1, stderr: err.message }));
          child.on('close', (code) => resolve({ agent, code, stderr }));
        })
    )
  );

  for (const result of results) {
    assert.equal(result.code, 0, `npm ci failed in ${result.agent.name}: ${tail(result.stderr)}`);
  }
  for (const agent of AGENTS) {
    assert.ok(
      fs.existsSync(path.join(agent.dir, 'node_modules', '.bin', isWin ? 'turbo.cmd' : 'turbo')),
      `${agent.name} has no local turbo after npm ci`
    );
  }
}

function parseSession(result, label) {
  assert.equal(result.code, 0, `${label} up failed (exit ${result.code}): ${tail(result.stderr)}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} up returned non-JSON stdout: ${tail(result.stdout)}`);
  }
}

async function startBoth() {
  log('Starting both stacks concurrently');
  const started = Date.now();
  const results = await Promise.all(AGENTS.map((agent) => ndAsync(['up', '--json'], agent.dir)));
  const sessions = {};
  results.forEach((result, index) => {
    sessions[AGENTS[index].name] = parseSession(result, AGENTS[index].name);
  });
  console.log(`  both stacks ready in ${Math.round((Date.now() - started) / 1000)}s`);
  return sessions;
}

function assertIsolation(sessions) {
  const a = sessions['agent-a'];
  const b = sessions['agent-b'];
  const ports = [...Object.values(a.ports), ...Object.values(b.ports)];
  assert.equal(new Set(ports).size, 6, `port allocations overlap: ${ports.join(', ')}`);
  assert.notEqual(a.database.api, b.database.api, 'API databases are not isolated');
  assert.notEqual(a.database.yhub, b.database.yhub, 'Yhub databases are not isolated');
  assert.notEqual(
    a.database.redisPrefix,
    b.database.redisPrefix,
    'Redis prefixes are not isolated'
  );
  assert.notEqual(a.instance, b.instance, 'instance ids are not isolated');

  for (const session of [a, b]) {
    assert.equal(session.status, 'running');
    for (const name of ['web', 'api', 'realtime']) {
      assert.equal(session.healthy[name], true, `${session.instance} ${name} is unhealthy`);
    }
  }
}

async function httpStatus(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status;
  } catch {
    return 0;
  }
}

async function sessionHealth(session) {
  const [web, api, realtime] = await Promise.all([
    httpStatus(session.urls.web),
    httpStatus(`${session.urls.api}/api/v1/instance/status`),
    httpStatus(`${session.urls.realtime}/api/ping/v1`),
  ]);
  return {
    web: web > 0 && web < 500,
    api: api === 200,
    realtime: realtime === 200,
  };
}

async function assertHealthy(label, session) {
  const health = await sessionHealth(session);
  assert.deepEqual(health, { web: true, api: true, realtime: true }, `${label} is unhealthy`);
}

function writeMarker(session) {
  psql(
    session.database.api,
    `DROP TABLE IF EXISTS ${MARKER_TABLE}; ` +
      `CREATE TABLE ${MARKER_TABLE} (run_id text); ` +
      `INSERT INTO ${MARKER_TABLE} (run_id) VALUES ('${RUN_ID}');`
  );
  redisCli(['SET', `${session.database.redisPrefix}:marker`, RUN_ID]);
}

function markerCount(session) {
  const exists = psql(
    session.database.api,
    `SELECT to_regclass('public.${MARKER_TABLE}') IS NOT NULL`
  );
  if (exists !== 't') return 0;
  return Number(psql(session.database.api, `SELECT count(*) FROM ${MARKER_TABLE}`));
}

function redisMarker(session) {
  return redisCli(['EXISTS', `${session.database.redisPrefix}:marker`]) === '1';
}

async function waitForPortsClosed(session) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const open = await Promise.all(Object.values(session.ports).map((port) => portOpen(port)));
    if (open.every((value) => !value)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Ports for ${session.instance} are still open after stop`);
    }
    await sleep(250);
  }
}

function statusEntry(payload, session) {
  const entry = payload.instances.find((item) => item.id === session.instance);
  assert.ok(entry, `status does not list ${session.instance}`);
  return entry;
}

function killTree(pid) {
  if (isWin) {
    run('taskkill', ['/pid', String(pid), '/T', '/F'], { allowFail: true });
    return;
  }
  process.kill(-Number(pid), 'SIGKILL');
}

async function runCheck() {
  checkTools();
  // Clear a previous interrupted run before snapshotting the main worktree: its
  // leftover databases must not be mistaken for main data that has to survive.
  await cleanupAll();
  const mainDatabasesBefore = adminDatabases();
  const mainStatusBefore = await mainStatuses();
  let sessions = {};

  try {
    setupWorktrees();
    await installWorktrees();

    sessions = await startBoth();
    assertIsolation(sessions);
    const a = sessions['agent-a'];
    const b = sessions['agent-b'];
    const bPids = { ...b.pids };

    const initialStatus = ndJson(['status', '--json']);
    for (const session of [a, b]) {
      const entry = statusEntry(initialStatus, session);
      assert.equal(entry.state, 'detached');
      assert.deepEqual(entry.ports, session.ports);
      assert.deepEqual(entry.pids, session.pids);
      assert.deepEqual(entry.healthy, { web: true, api: true, realtime: true });
      assert.equal(entry.database, session.database.api);
      assert.equal(entry.yhubDatabase, session.database.yhub);
      assert.equal(entry.redisPrefix, session.database.redisPrefix);
    }

    log('Verifying isolation markers and a scoped reset');
    writeMarker(a);
    writeMarker(b);
    assert.equal(markerCount(a), 1);
    assert.equal(markerCount(b), 1);
    assert.equal(redisMarker(a), true);
    assert.equal(redisMarker(b), true);

    const stopA = ndJson(['stop', '--json'], { cwd: AGENTS[0].dir });
    assert.equal(stopA.stopped.length, 3, 'agent-a did not stop all three services');
    await waitForPortsClosed(a);
    await assertHealthy('agent-b after agent-a stop', b);
    assert.deepEqual(b.pids, bPids, 'agent-b pids changed when agent-a stopped');

    const afterStop = statusEntry(ndJson(['status', '--json']), a);
    assert.equal(afterStop.state, 'stopped');
    assert.deepEqual(afterStop.pids, {});

    const reset = nd(['db', 'reset', '--yes'], {
      cwd: AGENTS[0].dir,
      allowFail: true,
      timeout: 240_000,
    });
    assert.equal(reset.status, 0, `agent-a db reset failed: ${tail(reset.stderr || reset.stdout)}`);
    assert.equal(markerCount(a), 0, 'agent-a marker survived its reset');
    assert.equal(redisMarker(a), false, 'agent-a Redis marker survived its reset');
    assert.equal(markerCount(b), 1, 'agent-b database was affected by agent-a reset');
    assert.equal(redisMarker(b), true, 'agent-b Redis marker was affected by agent-a reset');
    await assertHealthy('agent-b after agent-a reset', b);
    assert.deepEqual(b.pids, bPids, 'agent-b pids changed when agent-a reset');

    const logs = ndJson(['logs', '--json', '-n', '5'], { cwd: AGENTS[0].dir });
    assert.equal(logs.logs.length, 3, 'logs --json did not return all three services');
    for (const entry of logs.logs) {
      assert.ok(Array.isArray(entry.lines));
      assert.ok(entry.lines.length > 0, `${entry.service} has no log lines`);
      assert.ok(!entry.lines.join('\n').includes('\u001b'), `${entry.service} log has ANSI`);
    }

    log('Restarting agent-a and simulating an API crash');
    const upA = parseSession(await ndAsync(['up', '--json'], AGENTS[0].dir), 'agent-a');
    sessions['agent-a'] = upA;
    await assertHealthy('agent-a after restart', upA);
    assert.deepEqual(b.pids, bPids, 'agent-b pids changed when agent-a restarted');

    killTree(upA.pids.api);
    await sleep(1000);
    const crashed = statusEntry(ndJson(['status', '--json']), upA);
    assert.equal(crashed.state, 'detached');
    assert.equal(crashed.healthy.api, false, 'status did not report the API crash');
    assert.ok(!crashed.pids.api, 'status still reports the dead API pid');

    const failed = await ndAsync(['up', '--json'], AGENTS[0].dir);
    assert.equal(failed.code, 1, 'up did not fail after the API crash');
    assert.equal(failed.stdout.length, 0, 'failed up wrote JSON to stdout');
    assert.match(failed.stderr, /api\.log/, 'failed up did not name the API log');
    assert.match(failed.stderr, /No restart was attempted/, 'failed up tried to restart');
    assert.doesNotMatch(failed.stderr, /--- web/, 'failed up included an unrelated web tail');
    assert.doesNotMatch(
      failed.stderr,
      /--- realtime/,
      'failed up included an unrelated realtime tail'
    );

    const stopCrash = ndJson(['stop', '--json'], { cwd: AGENTS[0].dir });
    assert.deepEqual(
      stopCrash.stopped.map((entry) => entry.name).sort(),
      ['realtime', 'web'],
      'stop after a crash did not stop exactly the survivors'
    );

    const recovered = parseSession(await ndAsync(['up', '--json'], AGENTS[0].dir), 'agent-a');
    sessions['agent-a'] = recovered;
    await assertHealthy('agent-a after crash recovery', recovered);
    assert.deepEqual(b.pids, bPids, 'agent-b pids changed during agent-a recovery');

    const stopRecovered = ndJson(['stop', '--json'], { cwd: AGENTS[0].dir });
    assert.equal(stopRecovered.stopped.length, 3, 'agent-a did not stop after recovery');
    await assertHealthy('agent-b after scoped stop', b);
    assert.deepEqual(b.pids, bPids, 'agent-b pids changed after final scoped stop');

    log('All isolation, reset, crash and recovery checks passed');
  } finally {
    if (!KEEP) {
      await cleanupAll();
      const databasesAfter = adminDatabases();
      for (const database of mainDatabasesBefore) {
        assert.ok(
          databasesAfter.includes(database),
          `main worktree database ${database} disappeared`
        );
      }
      const statusAfter = await mainStatuses();
      assert.deepEqual(statusAfter, mainStatusBefore, 'main worktree stack changed');
      console.log('\n\x1b[32m✓ Main worktree databases and stack are untouched\x1b[0m');
    } else {
      console.log('\nKeeping verification worktrees in .nd/verify-instances');
      for (const session of Object.values(sessions)) {
        console.log(`  ${session.instance}: ${session.urls.web}`);
      }
    }
  }
}

/**
 * One verifier per checkout: a second run would start by cleaning the fixed
 * `.nd/verify-instances/agent-a|b` paths and remove the first run's worktrees.
 */
async function runExclusive() {
  const lock = await acquireLock(VERIFIER_LOCK, { label: 'verify:instances' });
  if (!lock) {
    throw new Error(
      `Another verify:instances run owns ${path.relative(ROOT, VERIFIER_LOCK)}. ` +
        'Wait for it to finish, or remove that file if no such run is alive.'
    );
  }
  try {
    await runCheck();
  } finally {
    releaseLock(lock);
  }
}

runExclusive().catch((err) => {
  console.error(`\n\x1b[31m✗ ${err.message}\x1b[0m`);
  if (process.env.ND_DEBUG === '1') console.error(err.stack);
  process.exitCode = 1;
});
