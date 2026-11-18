'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sleep, isPidAlive } = require('./proc');

/**
 * Small cross-process locks for the files under `<git>/nextdocs`.
 *
 * A lock is a file whose contents are the owner's identity. That identity is what makes
 * recovery safe: a lock left behind by a killed process is removed because its owner is
 * gone, never because it is old. A slow but live allocator keeps its lock no matter how
 * long it runs.
 */

/** Default wait before a caller gives up on the registry lock. */
const LOCK_TIMEOUT_MS = 35_000;
/** A lock file with no readable owner may be a creator in progress; leave it alone briefly. */
const OWNER_GRACE_MS = 5_000;
const MAX_STALE_RECOVERIES = 5;

/**
 * `pid:starttime` on Linux, `pid` elsewhere. The start time guards against PID reuse: a
 * recycled PID would otherwise look like a live owner forever.
 */
function processIdentity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 2 (comm) can contain spaces and parentheses, so count fields after the last
    // ')'. Field 3 is `state`, field 22 is `starttime`.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const started = fields[19];
    return started ? `${pid}:${started}` : `${pid}`;
  } catch {
    return `${pid}`;
  }
}

function createOwner(label) {
  return {
    pid: process.pid,
    identity: processIdentity(process.pid),
    host: os.hostname(),
    label: label || 'nd',
    token: crypto.randomBytes(8).toString('hex'),
    startedAt: new Date().toISOString(),
  };
}

function readLockOwner(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

/** A lock owned from another machine cannot be checked; assume the owner is still there. */
function ownerIsAlive(owner) {
  if (!owner) return false;
  if (owner.host && owner.host !== os.hostname()) return true;
  if (!isPidAlive(owner.pid)) return false;
  const identity = processIdentity(owner.pid);
  return !owner.identity || !identity || owner.identity === identity;
}

function describeOwner(owner) {
  if (!owner) return 'an unknown process';
  const label = owner.label ? `./nd ${owner.label}` : './nd';
  return owner.pid ? `${label} (pid ${owner.pid})` : label;
}

/**
 * Create the lock file with its complete owner document. Writing a temp file and
 * hard-linking it means a reader never sees a half-written owner; where hard links are
 * unavailable, O_EXCL is still atomic and the grace period covers the empty-file window.
 */
function createOwnerFile(file, owner) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(owner)}\n`;
  const temporary = `${file}.${owner.token}.tmp`;
  fs.writeFileSync(temporary, text);
  try {
    try {
      fs.linkSync(temporary, file);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false;
      try {
        fs.writeFileSync(file, text, { flag: 'wx' });
        return true;
      } catch (inner) {
        if (inner.code === 'EEXIST') return false;
        throw inner;
      }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * Remove a lock whose owner is verified gone. The token is re-read immediately before
 * unlinking so two recoverers cannot remove a lock that a third process just took.
 */
function breakStaleLock(file) {
  const observed = readLockOwner(file);
  if (observed) {
    if (ownerIsAlive(observed)) return false;
    const current = readLockOwner(file);
    if (!current || current.token !== observed.token) return false;
    fs.rmSync(file, { force: true });
    return true;
  }
  let age;
  try {
    age = Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return false;
  }
  if (age < OWNER_GRACE_MS) return false;
  fs.rmSync(file, { force: true });
  return true;
}

/**
 * Acquire `file` or return null. `waitMs` bounds the wait; a stale lock is recovered
 * immediately regardless of the wait, because its owner is known to be gone.
 */
async function acquireLock(file, { waitMs = 0, pollMs = 50, label = 'nd', onWait } = {}) {
  const owner = createOwner(label);
  const deadline = Date.now() + waitMs;
  let recoveries = 0;
  let announced = false;

  for (;;) {
    if (createOwnerFile(file, owner)) return { file, owner, label };

    const holder = readLockOwner(file);
    if (!(holder && ownerIsAlive(holder)) && recoveries < MAX_STALE_RECOVERIES) {
      if (breakStaleLock(file)) {
        recoveries += 1;
        continue;
      }
    }

    if (Date.now() >= deadline) return null;
    if (!announced && onWait) {
      announced = true;
      onWait(holder);
    }
    await sleep(pollMs);
  }
}

function releaseLock(handle) {
  if (!handle) return;
  const current = readLockOwner(handle.file);
  // Only the owner removes the lock: a recovered-and-retaken lock must survive this exit.
  if (current && current.token !== handle.owner.token) return;
  fs.rmSync(handle.file, { force: true });
}

/** Acquire, run, always release. Throws with the holder's identity on timeout. */
async function withLock(file, options, fn) {
  const waitMs = options && options.waitMs != null ? options.waitMs : LOCK_TIMEOUT_MS;
  const handle = await acquireLock(file, { ...options, waitMs });
  if (!handle) {
    const holder = readLockOwner(file);
    throw new Error(
      `Timed out waiting for ${path.basename(file)} (held by ${describeOwner(holder)}). ` +
        'If no such ./nd process is running, remove that file and retry.'
    );
  }
  try {
    return await fn(handle);
  } finally {
    releaseLock(handle);
  }
}

module.exports = {
  LOCK_TIMEOUT_MS,
  acquireLock,
  breakStaleLock,
  createOwner,
  describeOwner,
  ownerIsAlive,
  processIdentity,
  readLockOwner,
  releaseLock,
  withLock,
};
