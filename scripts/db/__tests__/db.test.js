'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const db = require('../index');
const constants = require('../../lib/constants');
const containers = require('../../lib/containers');
const flyway = require('../../lib/flyway');
const instances = require('../../lib/instance');
const prompt = require('../../lib/prompt');
const { ROOT } = require('../../lib/proc');

/**
 * These tests drive the destructive commands with stubbed containers: what matters here
 * is ordering (nothing is dropped before the checks) and ownership (a record is kept when
 * cleanup did not finish), not Docker itself.
 */

function stubMany(entries) {
  const restores = [];
  for (const [target, name, value] of entries) {
    const original = target[name];
    target[name] = value;
    restores.push(() => {
      target[name] = original;
    });
  }
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

function silenceConsole() {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
}

function cleanEnvironment() {
  const saved = { ...process.env };
  for (const name of [
    'SPRING_DATASOURCE_URL',
    'POSTGRES',
    'ATTACHMENT_STORAGE_PATH',
    'NEXTDOCS_ALLOW_REMOTE_DB',
    'NEXTDOCS_API_URL',
    'NEXTDOCS_REALTIME_URL',
  ]) {
    delete process.env[name];
  }
  return () => {
    process.env = saved;
  };
}

/** A recorded instance in a temporary registry; its worktree may be present or absent. */
async function scenario({ present = true } = {}) {
  const commonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-db-'));
  const worktree = path.join(commonDir, 'worktree');
  if (present) fs.mkdirSync(worktree, { recursive: true });
  const instance = await instances.resolveInstance({ worktree, env: {}, commonDir });
  constants.setInstance(instance);
  return instance;
}

function assertNoClaim(instance) {
  assert.equal(
    instances.instanceClaimOwner(instance),
    null,
    'the lifecycle claim must be released'
  );
}

/** Another record in the same registry whose worktree no longer exists. */
async function staleRecord(instance) {
  return instances.resolveInstance({
    worktree: path.join(instance.commonDir, 'gone-worktree'),
    env: {},
    commonDir: instance.commonDir,
  });
}

function resetHarness(instance, calls, overrides = []) {
  const entries = [
    [prompt, 'confirmDestructive', async () => true],
    [instances, 'resolveInstance', async () => instance],
    [flyway, 'requireLocalPostgres', () => {}],
    [flyway, 'flywayEnv', () => ({})],
    [
      flyway,
      'runFlyway',
      (goal) => {
        calls.push(`flyway:${goal}`);
        return 0;
      },
    ],
    [
      flyway,
      'migrationState',
      () => ({ installed: true, pending: 0, failed: 0, applied: 1, latest: 1 }),
    ],
    [
      containers,
      'ensurePostgres',
      () => {
        calls.push('ensurePostgres');
      },
    ],
    [
      containers,
      'ensureRedis',
      () => {
        calls.push('ensureRedis');
      },
    ],
    [
      containers,
      'yhubInitializerPath',
      () => {
        calls.push('yhubInitializer');
        return '/tmp/init-db.js';
      },
    ],
    [
      containers,
      'ensureDatabases',
      () => {
        calls.push('ensureDatabases');
      },
    ],
    [
      containers,
      'dropDatabase',
      (name) => {
        calls.push(`drop:${name}`);
      },
    ],
    [
      containers,
      'redisFlushPrefix',
      (prefix) => {
        calls.push(`redis:${prefix}`);
        return 0;
      },
    ],
  ];
  for (const [module, name, value] of overrides) {
    const index = entries.findIndex(([target, key]) => target === module && key === name);
    if (index >= 0) entries[index] = [module, name, value];
    else entries.push([module, name, value]);
  }
  return stubMany(entries);
}

test('reset refuses when a start claims the worktree during the confirmation', async () => {
  const env = cleanEnvironment();
  const silence = silenceConsole();
  const instance = await scenario();
  const calls = [];
  let held = null;
  const restore = resetHarness(instance, calls, [
    [
      prompt,
      'confirmDestructive',
      async () => {
        // The user typed "yes", but `./nd dev` won the worktree while the prompt was open.
        held = await instances.claimInstance(instance, { waitMs: 0, label: 'dev' });
        return true;
      },
    ],
  ]);
  try {
    assert.equal(await db.resetCommand(['--yes', '--keep-files']), 1);
    assert.deepEqual(calls, [], 'no database, Redis key or Flyway run may be touched');
  } finally {
    instances.releaseInstanceClaim(held);
    restore();
    silence();
    env();
  }
  assert.deepEqual(instances.liveServicePids(instance), {});
  assert.ok(
    fs.existsSync(path.join(instance.registry, `${instance.id}.json`)),
    'the record is the handle a start needs; reset must not remove it'
  );
  assertNoClaim(instance);
});

for (const [label, module, name] of [
  ['the local Flyway environment', flyway, 'flywayEnv'],
  ['Redis', containers, 'ensureRedis'],
  ['the Yhub initializer', containers, 'yhubInitializerPath'],
]) {
  test(`reset validates ${label} before dropping either database`, async () => {
    const env = cleanEnvironment();
    const silence = silenceConsole();
    const instance = await scenario();
    const calls = [];
    const restore = resetHarness(instance, calls, [
      [
        module,
        name,
        () => {
          throw new Error(`${label} is not usable`);
        },
      ],
    ]);
    try {
      // The failure propagates; `./nd` prints it and exits nonzero without dropping.
      await assert.rejects(db.resetCommand(['--yes', '--keep-files']), /is not usable/);
      assert.deepEqual(
        calls.filter((entry) => entry.startsWith('drop:')),
        [],
        'the drop must not run when a preflight check fails'
      );
      assertNoClaim(instance);
    } finally {
      restore();
      silence();
      env();
    }
  });
}

test('a Redis failure is reported after the API database was migrated', async () => {
  const env = cleanEnvironment();
  const silence = silenceConsole();
  const instance = await scenario();
  const calls = [];
  const restore = resetHarness(instance, calls, [
    [
      containers,
      'redisFlushPrefix',
      () => {
        calls.push('redis');
        throw new Error('Redis is still loading the dataset');
      },
    ],
  ]);
  try {
    assert.equal(await db.resetCommand(['--yes', '--keep-files']), 1);
    assert.ok(calls.includes(`drop:${instance.database}`));
    assert.ok(calls.includes(`drop:${instance.yhubDatabase}`));
    assert.ok(
      calls.includes('flyway:migrate'),
      'a Redis failure must not leave the API database unmigrated'
    );
    assertNoClaim(instance);
  } finally {
    restore();
    silence();
    env();
  }
});

test('an attachment cleanup failure is reported without skipping the migration', async () => {
  const env = cleanEnvironment();
  const silence = silenceConsole();
  const instance = await scenario();
  const directory = `nd-reset-test-${process.pid}`;
  const storage = path.join(ROOT, 'api', 'data', directory);
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(path.join(storage, 'attachment.txt'), 'x');
  process.env.ATTACHMENT_STORAGE_PATH = `data/${directory}`;

  const calls = [];
  const restore = resetHarness(instance, calls);
  const originalRm = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target).includes(directory)) throw new Error('EACCES: permission denied');
    return originalRm(target, options);
  };
  try {
    assert.equal(await db.resetCommand(['--yes']), 1);
    assert.ok(calls.includes('flyway:migrate'), 'migration must still run');
    assert.ok(calls.includes(`drop:${instance.database}`));
  } finally {
    fs.rmSync = originalRm;
    fs.rmSync(storage, { recursive: true, force: true });
    restore();
    silence();
    env();
  }
});

test('a reset records the worktree before provisioning and migrates after the drops', async () => {
  const env = cleanEnvironment();
  const silence = silenceConsole();
  const instance = await scenario();
  const calls = [];
  const restore = resetHarness(instance, calls, [
    [
      instances,
      'resolveInstance',
      async () => {
        calls.push('resolveInstance');
        return instance;
      },
    ],
  ]);
  try {
    assert.equal(await db.resetCommand(['--yes', '--keep-files']), 0);
    assertNoClaim(instance);
  } finally {
    restore();
    silence();
    env();
  }

  // A worktree that never ran dev/up still gets a record, so `db prune` can find the
  // databases this reset created; nothing is provisioned or dropped before it exists.
  assert.ok(calls.indexOf('resolveInstance') >= 0);
  assert.ok(calls.indexOf('resolveInstance') < calls.indexOf('ensurePostgres'));
  assert.ok(calls.indexOf('resolveInstance') < calls.indexOf(`drop:${instance.database}`));
  assert.ok(
    calls.indexOf(`drop:${instance.yhubDatabase}`) < calls.indexOf('ensureDatabases'),
    'the Yhub schema is initialized after the old database is dropped'
  );
  assert.ok(calls.indexOf('ensureDatabases') < calls.indexOf('flyway:migrate'));
  assert.ok(calls.includes(`redis:${instance.redisPrefix}`));
});

function pruneHarness(overrides = []) {
  return stubMany([
    [flyway, 'requireLocalPostgres', () => {}],
    [prompt, 'confirmDestructive', async () => true],
    [containers, 'containerRunning', () => true],
    ...overrides,
  ]);
}

test('prune keeps a record with an empty Redis prefix and deletes nothing', async () => {
  const env = cleanEnvironment();
  const silence = silenceConsole();
  const instance = await scenario();
  const stale = await staleRecord(instance);
  instances.updateRecord(stale.registry, stale.id, { redisPrefix: '' });

  const calls = [];
  const restore = pruneHarness([
    [
      containers,
      'dropDatabase',
      (name) => {
        calls.push(`drop:${name}`);
      },
    ],
    [
      containers,
      'redisFlushPrefix',
      (prefix) => {
        calls.push(`redis:${prefix}`);
      },
    ],
  ]);
  try {
    assert.equal(await db.pruneCommand(['--yes']), 1);
    assert.deepEqual(calls, [], 'invalid metadata must not delete or flush anything');
  } finally {
    restore();
    silence();
    env();
  }

  const kept = instances.readRecord(instance.registry, stale.id);
  assert.ok(kept, 'the record is the only place the names are written down');
  assert.equal(kept.prune, undefined, 'the prune claim must be released for a later retry');
});

test('prune keeps the databases of a worktree restored after the confirmation', async () => {
  const env = cleanEnvironment();
  const silence = silenceConsole();
  const instance = await scenario();
  const stale = await staleRecord(instance);

  const calls = [];
  const restore = pruneHarness([
    [
      prompt,
      'confirmDestructive',
      async () => {
        fs.mkdirSync(stale.worktree, { recursive: true });
        return true;
      },
    ],
    [
      containers,
      'dropDatabase',
      (name) => {
        calls.push(`drop:${name}`);
      },
    ],
    [
      containers,
      'redisFlushPrefix',
      (prefix) => {
        calls.push(`redis:${prefix}`);
      },
    ],
  ]);
  try {
    assert.equal(await db.pruneCommand(['--yes']), 1);
    assert.deepEqual(calls, []);
  } finally {
    restore();
    silence();
    env();
  }

  assert.ok(fs.existsSync(stale.worktree));
  assert.ok(instances.readRecord(instance.registry, stale.id));
  assert.equal(instances.readRecord(instance.registry, stale.id).prune, undefined);
});

test('prune drops both databases and the prefix, then removes the record', async () => {
  const env = cleanEnvironment();
  const silence = silenceConsole();
  const instance = await scenario();
  const stale = await staleRecord(instance);

  const calls = [];
  const restore = pruneHarness([
    [
      containers,
      'dropDatabase',
      (name) => {
        calls.push(`drop:${name}`);
      },
    ],
    [
      containers,
      'redisFlushPrefix',
      (prefix) => {
        calls.push(`redis:${prefix}`);
        return 1;
      },
    ],
  ]);
  try {
    assert.equal(await db.pruneCommand(['--yes']), 0);
  } finally {
    restore();
    silence();
    env();
  }

  assert.deepEqual(calls, [
    `drop:${stale.database}`,
    `drop:${stale.yhubDatabase}`,
    `redis:${stale.redisPrefix}`,
  ]);
  assert.equal(instances.readRecord(instance.registry, stale.id), null);
  assert.ok(instances.readRecord(instance.registry, instance.id), 'the live instance is untouched');
});
