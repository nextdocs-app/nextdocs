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
 * Whether the captured copy belongs to an owner that is gone. The captured file has a
 * name only this process knows, so its contents cannot change under the decision, unlike
 * the lock path itself.
 */
function capturedOwnerIsGone(captured) {
  const owner = readLockOwner(captured);
  if (owner) return !ownerIsAlive(owner);
  // No readable owner: a creator may still be filling the file. Leave it alone until the
  // grace period passes, then recover it like a dead owner.
  try {
    return Date.now() - fs.statSync(captured).mtimeMs >= OWNER_GRACE_MS;
  } catch {
    return false;
  }
}

/**
 * Put a captured lock back under its canonical name, without replacing a lock created
 * while it was aside. `link` is create-if-absent, so whichever writer loses keeps its
 * file intact and the other one is not duplicated.
 */
function restoreCapturedLock(captured, file) {
  try {
    fs.linkSync(captured, file);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    return false;
  } finally {
    fs.rmSync(captured, { force: true });
  }
}

/**
 * Remove a lock whose owner is gone, or put it back when it turned out to be live.
 *
 * The lock path is captured with `rename`, not deleted after a token comparison: another
 * process can replace the lock between the check and the delete, and the delete then
 * removes a lock its new owner is holding. After the rename the contents belong to this
 * process alone, so the owner is decided on the same bytes the delete would have removed.
 * A lock that changed hands in that window is restored untouched; the empty window left
 * by the rename is closed by `link` refusing to overwrite a lock created in it.
 */
function breakStaleLock(file) {
  const captured = `${file}.${crypto.randomBytes(6).toString('hex')}.stale`;
  try {
    fs.renameSync(file, captured);
  } catch (err) {
    // Another recoverer captured (and removed) it first; it may also have been released.
    if (err.code === 'ENOENT') return false;
    // Windows reports an open-by-another-process rename as EPERM. That is a sharing
    // violation, not a broken lock: leave it and let the caller retry or wait.
    if (err.code === 'EPERM') return false;
    throw err;
  }
  if (!capturedOwnerIsGone(captured)) {
    restoreCapturedLock(captured, file);
    return false;
  }
  fs.rmSync(captured, { force: true });
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

/**
 * Block the thread. The synchronous lock path has to sleep without promises: it runs in
 * the `exit` handler, where awaiting anything would let the process finish first.
 */
function sleepSync(ms) {
  // `Atomics.wait` is a real sleep, not a spin, and needs no child process.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Synchronous sibling of {@link acquireLock}, for callers that cannot await (an `exit`
 * handler). `waitMs` bounds the wait, like the async version. Node permits
 * `Atomics.wait` on the main thread; the event loop is blocked only by the caller that
 * chose this path.
 */
function acquireLockSync(file, { waitMs = 0, pollMs = 25, label = 'nd' } = {}) {
  const owner = createOwner(label);
  const deadline = Date.now() + waitMs;
  let recoveries = 0;

  for (;;) {
    if (createOwnerFile(file, owner)) return { file, owner, label };

    const holder = readLockOwner(file);
    if (!(holder && ownerIsAlive(holder)) && recoveries < MAX_STALE_RECOVERIES) {
      if (breakStaleLock(file)) {
        recoveries += 1;
        continue;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    sleepSync(Math.min(pollMs, remaining));
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
  acquireLockSync,
  breakStaleLock,
  createOwner,
  describeOwner,
  ownerIsAlive,
  processIdentity,
  readLockOwner,
  releaseLock,
  withLock,
};
