'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, sleep } = require('./proc');
const { PORT_NAMES, allocatePorts } = require('./ports');

/**
 * One NextDocs development stack per git worktree.
 *
 * The containers are shared (Postgres on 5433, Redis on 6379, Mailpit on 1025/8025),
 * but every worktree gets its own database pair, its own Yhub Redis prefix and its own
 * three ports. The allocation is persisted in the repository's git directory, so it is
 * shared by all worktrees, survives a restart, and lets `./nd dev api` in one terminal
 * agree with `./nd dev web` in another.
 *
 * The main worktree keeps the historical names (`nextdocs` / `nextdocs_yhub`, prefix
 * `yhub`, ports 3000/8080/1234) so existing local data and muscle memory survive.
 */

const isWin = process.platform === 'win32';
const DEFAULT_PORTS = { web: 3000, api: 8080, realtime: 1234 };
/** The services one `./nd dev` can start in this worktree. */
const SERVICE_NAMES = ['web', 'api', 'realtime'];
const RECORD_VERSION = 1;
const MAX_ID_LENGTH = 24;
const LOCK_STALE_MS = 30_000;
// Must outlast the staleness threshold: a waiter that gave up earlier told the user to
// delete the lock by hand even though the next attempt would have taken it over.
const LOCK_TIMEOUT_MS = LOCK_STALE_MS + 5_000;

const PINNED_PORT_ENV = {
  web: 'ND_WEB_PORT',
  api: 'ND_API_PORT',
  realtime: 'ND_REALTIME_PORT',
};

function gitCommonDir(worktree) {
  const result = spawnSync('git', ['-C', worktree, 'rev-parse', '--git-common-dir'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    // A standalone copy without `.git` is the one case where the default names are
    // intended. A checkout whose git call failed must not silently resolve to the main
    // worktree: `db reset` would then target the wrong databases.
    if (fs.existsSync(path.join(worktree, '.git'))) {
      const reason = result.error ? result.error.message : (result.stderr || '').trim();
      throw new Error(
        `git could not describe the worktree at ${worktree}` +
          (reason ? `: ${reason}` : '') +
          '. Refusing to fall back to the main worktree.'
      );
    }
    return null;
  }
  const raw = (result.stdout || '').trim();
  if (!raw) {
    if (fs.existsSync(path.join(worktree, '.git'))) {
      throw new Error(`git returned an empty common directory for ${worktree}.`);
    }
    return null;
  }
  return path.resolve(worktree, raw);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return isWin ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isMainWorktree(worktree, commonDir) {
  if (!commonDir) return true;
  return samePath(commonDir, path.join(path.resolve(worktree), '.git'));
}

function repositoryName(commonDir) {
  return commonDir ? path.basename(path.dirname(path.resolve(commonDir))) : 'nextdocs';
}

/**
 * Branch-style worktree directory names are `nextdocs` as often as not (the tool that
 * creates them nests them under a readable parent), so fall back to the parent when the
 * basename is just the repository name.
 */
function readableName(worktree, commonDir) {
  const resolved = path.resolve(worktree);
  const base = path.basename(resolved);
  const repo = repositoryName(commonDir);
  if (base.toLowerCase() !== repo.toLowerCase()) return base;
  const parent = path.basename(path.dirname(resolved));
  return parent && parent.toLowerCase() !== repo.toLowerCase() ? parent : base;
}

function sanitizeName(value) {
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, MAX_ID_LENGTH - 5) || 'worktree';
}

/**
 * `main` for the primary worktree, `<readable>_<hash4>` otherwise. The hash is over the
 * absolute path, so two worktrees that share a directory name (or a renamed branch)
 * still address different databases.
 */
function instanceId(worktree, commonDir) {
  const resolved = path.resolve(worktree);
  if (isMainWorktree(resolved, commonDir)) return 'main';
  // Windows paths are case-insensitive; the same worktree invoked as C:\Repo and
  // c:\repo must keep one id, or it would allocate a second set of databases/ports.
  const key = isWin ? resolved.toLowerCase() : resolved;
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 4);
  return `${sanitizeName(readableName(resolved, commonDir))}_${hash}`;
}

function databaseNames(id) {
  if (id === 'main') {
    return { database: 'nextdocs', yhubDatabase: 'nextdocs_yhub' };
  }
  return {
    database: `nextdocs_${id}`,
    yhubDatabase: `nextdocs_${id}_yhub`,
  };
}

function redisPrefix(id) {
  return id === 'main' ? 'yhub' : `yhub_${id}`;
}

/** Registry lives in the git directory (shared by worktrees, never committed). */
function registryDir(commonDir, worktree) {
  return commonDir
    ? path.join(path.resolve(commonDir), 'nextdocs', 'instances')
    : path.join(path.resolve(worktree), '.nd', 'instances');
}

function buildRecord({ id, worktree, ports, createdAt = Date.now() }) {
  const names = databaseNames(id);
  return {
    version: RECORD_VERSION,
    id,
    worktree: path.resolve(worktree),
    ports: { ...ports },
    database: names.database,
    yhubDatabase: names.yhubDatabase,
    redisPrefix: redisPrefix(id),
    createdAt,
    updatedAt: Date.now(),
    supervisorPid: null,
    /** Which services the foreground supervisor started; null when none is running. */
    supervisorServices: null,
  };
}

function recordPath(dir, id) {
  return path.join(dir, `${id}.json`);
}

function readRecord(dir, id) {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath(dir, id), 'utf8'));
    if (!parsed || parsed.id !== id || !parsed.ports) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRecord(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const target = recordPath(dir, record.id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

function updateRecord(dir, id, patch) {
  const record = readRecord(dir, id);
  if (!record) return null;
  const updated = { ...record, ...patch, updatedAt: Date.now() };
  writeRecord(dir, updated);
  return updated;
}

function removeRecord(dir, id) {
  fs.rmSync(recordPath(dir, id), { force: true });
}

function listRecords(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const record = readRecord(dir, entry.name.slice(0, -'.json'.length));
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

function isPidAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    // Signal 0 is a liveness probe. EPERM means the process exists but belongs to
    // another user; on Windows access checks can produce it as well. Only ESRCH is
    // a definitive "gone".
    return err.code === 'EPERM';
  }
}

/** A record's worktree can be gone while the record (and its databases) remain. */
function isWorktreePresent(record) {
  return Boolean(record.worktree) && fs.existsSync(record.worktree);
}

function pinnedPorts(env) {
  const ports = {};
  for (const [name, variable] of Object.entries(PINNED_PORT_ENV)) {
    const raw = env[variable];
    if (raw == null || !String(raw).trim()) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`${variable} must be a TCP port between 1 and 65535, received "${raw}".`);
    }
    ports[name] = value;
  }
  return ports;
}

function applyPinned(record, env) {
  const pins = pinnedPorts(env);
  if (Object.keys(pins).length === 0) return record;
  return { ...record, ports: { ...record.ports, ...pins } };
}

async function withRegistryLock(dir, fn) {
  // Lock next to the records, not inside them: `<git>/nextdocs/lock`.
  const lockDir = path.join(path.dirname(dir), 'lock');
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lockDir).mtimeMs;
      } catch {
        // The holder released it between the mkdir and the stat; retry immediately.
        continue;
      }
      if (age > LOCK_STALE_MS) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the instance registry lock (${lockDir}). ` +
            'If no ./nd process is starting, remove that directory and retry.'
        );
      }
      await sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function reservedPorts(records, id) {
  const ports = [];
  for (const record of records) {
    if (record.id === id) continue;
    for (const value of Object.values(record.ports || {})) {
      const port = Number(value);
      if (Number.isInteger(port)) ports.push(port);
    }
  }
  return ports;
}

/**
 * A sticky record keeps its saved ports; a pin that changes one still has to respect
 * the other worktrees and the instance's own three values. The allocation path already
 * enforces both when it picks a fresh set.
 */
function assertPinsUsable(pins, ports, reserved) {
  if (Object.keys(pins).length === 0) return;
  const taken = new Set(reserved.map(Number));
  for (const [name, port] of Object.entries(pins)) {
    if (taken.has(port)) {
      throw new Error(
        `Port ${port} for ${name} is already reserved by another worktree. ` +
          `Choose another ${PINNED_PORT_ENV[name]} value.`
      );
    }
  }
  const seen = new Map();
  for (const [name, port] of Object.entries(ports)) {
    if (seen.has(port)) {
      throw new Error(
        `Port ${port} is assigned to both ${seen.get(port)} and ${name}. ` +
          'Choose a different ND_*_PORT value.'
      );
    }
    seen.set(port, name);
  }
}

/**
 * Read-only view for commands that must not create state (`db`, `seed`, `urls`).
 * Falls back to the default ports when this worktree never started a stack; the
 * database names are still its own, because they are derived from the instance id.
 */
function peekInstance({ worktree = ROOT, env = process.env, commonDir: injected } = {}) {
  const resolved = path.resolve(worktree);
  const commonDir = injected === undefined ? gitCommonDir(resolved) : injected;
  const id = instanceId(resolved, commonDir);
  const dir = registryDir(commonDir, resolved);
  const record = readRecord(dir, id);
  const base = applyPinned(
    record || buildRecord({ id, worktree: resolved, ports: DEFAULT_PORTS }),
    env
  );
  return {
    ...base,
    registry: dir,
    commonDir,
    isMain: id === 'main',
    hasRecord: Boolean(record),
    running: isPidAlive(base.supervisorPid),
    source: record ? 'record' : 'defaults',
  };
}

/**
 * Allocate (or reuse) this worktree's ports and persist the record. Called before any
 * service starts; `newPorts` and `portOffset` are the explicit re-roll paths.
 */
async function resolveInstance({
  worktree = ROOT,
  newPorts = false,
  portOffset = null,
  env = process.env,
  commonDir: injected,
} = {}) {
  const resolved = path.resolve(worktree);
  const commonDir = injected === undefined ? gitCommonDir(resolved) : injected;
  const id = instanceId(resolved, commonDir);
  const dir = registryDir(commonDir, resolved);
  const pins = pinnedPorts(env);
  const offset = portOffset == null ? null : Number(portOffset);

  if (offset != null && (!Number.isInteger(offset) || offset < 0 || offset > 30_000)) {
    throw new Error(
      `--port-offset must be an integer between 0 and 30000, received "${portOffset}".`
    );
  }

  return withRegistryLock(dir, async () => {
    const existing = readRecord(dir, id);
    const live =
      existing &&
      (isPidAlive(existing.supervisorPid) || Object.keys(liveServicePids(existing)).length > 0);
    if (live && (newPorts || offset != null)) {
      throw new Error(`Instance '${id}' is running; stop it before changing its ports.`);
    }
    const sticky = Boolean(existing) && !newPorts && offset == null;

    let ports;
    if (sticky) {
      ports = { ...existing.ports, ...pins };
      assertPinsUsable(pins, ports, reservedPorts(listRecords(dir), id));
      if (live && PORT_NAMES.some((name) => ports[name] !== existing.ports[name])) {
        throw new Error(`Instance '${id}' is running; stop it before changing its ports.`);
      }
    } else {
      const preferred = { ...DEFAULT_PORTS, ...pins };
      if (offset != null) {
        for (const name of Object.keys(preferred)) preferred[name] += offset;
        for (const [name, port] of Object.entries(preferred)) {
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            const source = pins[name]
              ? `${PINNED_PORT_ENV[name]}=${pins[name]} plus --port-offset ${offset}`
              : `--port-offset ${offset}`;
            throw new Error(`Port ${port} for ${name} is outside 1-65535 (${source}).`);
          }
        }
      }
      ports = await allocatePorts({
        preferred,
        reserved: reservedPorts(listRecords(dir), id),
        strict: offset != null ? true : Object.keys(pins),
      });
    }

    const record = {
      ...(existing || buildRecord({ id, worktree: resolved, ports })),
      id,
      worktree: resolved,
      ports,
      database: databaseNames(id).database,
      yhubDatabase: databaseNames(id).yhubDatabase,
      redisPrefix: redisPrefix(id),
      updatedAt: Date.now(),
    };
    writeRecord(dir, record);

    return {
      ...record,
      registry: dir,
      commonDir,
      isMain: id === 'main',
      hasRecord: true,
      running: isPidAlive(record.supervisorPid),
      source: 'record',
    };
  });
}

/**
 * Claim the supervisor slot for `./nd status`/`down`.
 *
 * `./nd dev api` and `./nd dev web` in separate terminals share one worktree, so the
 * last starter owns the slot; status also treats an open port as running. `services` is
 * what makes a second start in the same worktree detectable: without it a supervisor
 * could only say "something is running", not "the service you are asking for".
 */
function setSupervisor(instance, pid = process.pid, services = null) {
  const owned = Array.isArray(services)
    ? SERVICE_NAMES.filter((name) => services.includes(name))
    : null;
  return updateRecord(instance.registry, instance.id, {
    supervisorPid: pid,
    supervisorServices: owned && owned.length > 0 ? owned : null,
  });
}

function clearSupervisor(instance, pid = process.pid) {
  const record = readRecord(instance.registry, instance.id);
  if (!record || Number(record.supervisorPid) !== Number(pid)) return null;
  return updateRecord(instance.registry, instance.id, {
    supervisorPid: null,
    supervisorServices: null,
  });
}

/**
 * Services the recorded foreground supervisor started.
 *
 * A record written before the service set was stored cannot say which half of the
 * stack it owns, so it is read as owning all of it: refusing one unnecessary start is
 * recoverable, two processes binding one port is not.
 */
function supervisorServices(record) {
  const stored = record && record.supervisorServices;
  const known = Array.isArray(stored) ? SERVICE_NAMES.filter((name) => stored.includes(name)) : [];
  return known.length > 0 ? known : [...SERVICE_NAMES];
}

/**
 * Detached services are owned by pids, not by a supervisor. Only live pids are kept:
 * a crashed service must not make `./nd status` claim the stack is running.
 */
function setServicePids(instance, pids) {
  const live = {};
  for (const [name, pid] of Object.entries(pids || {})) {
    if (isPidAlive(pid)) live[name] = Number(pid);
  }
  return updateRecord(instance.registry, instance.id, {
    pids: live,
    supervisorPid: null,
    supervisorServices: null,
  });
}

function clearServicePids(instance) {
  return updateRecord(instance.registry, instance.id, { pids: {} });
}

function liveServicePids(record) {
  const live = {};
  for (const [name, pid] of Object.entries((record && record.pids) || {})) {
    if (isPidAlive(pid)) live[name] = Number(pid);
  }
  return live;
}
module.exports = {
  DEFAULT_PORTS,
  PINNED_PORT_ENV,
  buildRecord,
  clearServicePids,
  clearSupervisor,
  databaseNames,
  gitCommonDir,
  instanceId,
  isMainWorktree,
  isPidAlive,
  isWorktreePresent,
  listRecords,
  liveServicePids,
  peekInstance,
  readableName,
  redisPrefix,
  registryDir,
  removeRecord,
  resolveInstance,
  sanitizeName,
  setServicePids,
  setSupervisor,
  supervisorServices,
  updateRecord,
};
