'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spawn } = require('node:child_process');

const {
  acquireLock,
  createOwner,
  processIdentity,
  readLockOwner,
  releaseLock,
  withLock,
} = require('../lock');

function lockPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nd-lock-')), 'test.lock');
}

function liveChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

function deadOwner() {
  // A pid that is certainly not running. The identity is the fallback the platform
  // reports, so the liveness check is the one that decides.
  const pid = 2_147_483_647;
  return { pid, identity: processIdentity(pid), host: os.hostname(), label: 'dead', token: 'x' };
}

test('a lock is exclusive while held and reusable after release', async () => {
  const file = lockPath();
  const first = await acquireLock(file, { label: 'first' });
  assert.ok(first);
  assert.equal(await acquireLock(file, { waitMs: 0, label: 'second' }), null);
  assert.equal(readLockOwner(file).label, 'first');

  releaseLock(first);
  assert.equal(fs.existsSync(file), false);
  const second = await acquireLock(file, { label: 'second' });
  assert.ok(second);
  releaseLock(second);
});

test('release only removes the lock its own token owns', async () => {
  const file = lockPath();
  const handle = await acquireLock(file);
  // Simulate a newer owner that replaced this one after a stale recovery.
  fs.writeFileSync(file, `${JSON.stringify({ ...createOwner('other'), token: 'other' })}\n`);
  releaseLock(handle);
  assert.equal(readLockOwner(file).token, 'other');
});

test('a lock left by a dead owner is recovered without an age wait', async () => {
  const file = lockPath();
  fs.writeFileSync(file, `${JSON.stringify(deadOwner())}\n`);
  const handle = await acquireLock(file, { waitMs: 0, label: 'recovered' });
  assert.ok(handle, 'a dead owner must not block the next command');
  releaseLock(handle);
});

test('a slow but live owner keeps its lock however old the file is', async () => {
  const file = lockPath();
  const child = liveChild();
  try {
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        ...createOwner('slow allocator'),
        pid: child.pid,
        identity: processIdentity(child.pid),
      })}\n`
    );
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(file, old, old);

    assert.equal(await acquireLock(file, { waitMs: 0, label: 'intruder' }), null);
    assert.equal(readLockOwner(file).label, 'slow allocator');
  } finally {
    child.kill('SIGKILL');
  }
});

test('a pid reused by another process does not keep a dead owner alive', async (t) => {
  const file = lockPath();
  const handle = await acquireLock(file);
  const owner = readLockOwner(file);
  releaseLock(handle);
  if (owner.identity === `${process.pid}`) {
    return t.skip('this platform cannot identify a process generation');
  }
  // Same live pid, different generation: the original owner is gone.
  fs.writeFileSync(file, `${JSON.stringify({ ...owner, identity: `${process.pid}:0` })}\n`);
  const recovered = await acquireLock(file, { waitMs: 0 });
  assert.ok(recovered);
  releaseLock(recovered);
});

test('a lock file with no readable owner is recovered after the grace period', async () => {
  const file = lockPath();
  fs.writeFileSync(file, 'not json');
  assert.equal(
    await acquireLock(file, { waitMs: 0 }),
    null,
    'a creator may be between creating the file and writing its owner'
  );

  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(file, old, old);
  const handle = await acquireLock(file, { waitMs: 0 });
  assert.ok(handle, 'an abandoned half-created lock must not block the worktree forever');
  releaseLock(handle);
});

test('withLock reports the holder when it times out', async () => {
  const file = lockPath();
  const holder = await acquireLock(file, { label: 'db reset' });
  try {
    await assert.rejects(
      withLock(file, { label: 'dev', waitMs: 100 }, () => assert.fail('must not run')),
      /db reset \(pid \d+\)/
    );
  } finally {
    releaseLock(holder);
  }
});
