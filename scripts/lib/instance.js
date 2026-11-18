'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, sleep, isPidAlive } = require('./proc');
const { PORT_NAMES, allocatePorts } = require('./ports');
const {
  LOCK_TIMEOUT_MS,
  acquireLock,
  describeOwner,
  readLockOwner,
  releaseLock,
  withLock,
} = require('./lock');

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
const RECORD_VERSION = 2;
const MAX_ID_LENGTH = 24;

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
  const result = spawnSync('git', ['-C', worktree, 'rev-parse', '--absolute-git-dir'], {
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout.trim()) return samePath(commonDir, result.stdout.trim());
  // A caller may supply a common directory for a not-yet-created worktree.
  if (!fs.existsSync(path.join(worktree, '.git'))) return false;
  throw new Error(`git could not determine the worktree directory at ${worktree}.`);
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
    /** Absolute attachment directory the API was started with; null until a start. */
    attachmentStorage: null,
    createdAt,
    updatedAt: Date.now(),
    /** Every foreground `./nd dev` running in this worktree, one entry per process. */
    supervisors: [],
    /** Detached `./nd up` services, owned by pid. */
    pids: {},
  };
}

/**
 * Records written by an older CLI kept a single supervisor slot. Reading it as a list of
 * one keeps `status`/`stop` working across an upgrade; the field is dropped on the next
 * write, so the legacy shape does not spread.
 */
function supervisorsOf(record) {
  if (!record) return [];
  const stored = Array.isArray(record.supervisors)
    ? record.supervisors.filter((entry) => entry && Number.isInteger(Number(entry.pid)))
    : [];
  if (stored.length > 0 || !record.supervisorPid) return stored;
  return [
    {
      pid: Number(record.supervisorPid),
      services: Array.isArray(record.supervisorServices) ? record.supervisorServices : null,
      startedAt: Number(record.updatedAt) || Date.now(),
    },
  ];
}

function normalizeRecord(record) {
  const { supervisorPid, supervisorServices: legacyServices, prune, ...rest } = record;
  return {
    ...rest,
    version: RECORD_VERSION,
    supervisors: supervisorsOf(record),
    pids: rest.pids && typeof rest.pids === 'object' ? rest.pids : {},
    ...(prune ? { prune } : {}),
  };
}

function recordPath(dir, id) {
  return path.join(dir, `${id}.json`);
}

function readRecord(dir, id) {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath(dir, id), 'utf8'));
    if (!parsed || parsed.id !== id || !parsed.ports) return null;
    return normalizeRecord(parsed);
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

function assertRecordWorktree(record, worktree) {
  if (record && (!record.worktree || !samePath(record.worktree, worktree))) {
    throw new Error(`Instance '${record.id}' belongs to another worktree; refusing to reuse it.`);
  }
}

function registryLockPath(dir) {
  // Lock next to the records, not inside them: `<git>/nextdocs/lock`.
  return path.join(path.dirname(dir), 'lock');
}

/**
 * Serialise every read-modify-write of the registry (allocation, claims, prune). The lock
 * records its owner, so a lock left by a killed process is recovered by checking that the
 * owner is gone instead of waiting for an age-based takeover.
 */
function withRegistryLock(dir, fn, { waitMs = LOCK_TIMEOUT_MS } = {}) {
  return withLock(registryLockPath(dir), { label: 'instance registry', waitMs }, fn);
}

/** One lifecycle claim per instance, shared by `dev`, `up` and destructive db commands. */
function instanceClaimPath(dir, id) {
  return path.join(path.dirname(dir), 'claims', `${id}.lock`);
}

function instanceClaimOwner(instance) {
  return readLockOwner(instanceClaimPath(instance.registry, instance.id));
}

/**
 * Claim this worktree's start/reset slot. A reset confirms, claims, then rechecks the
 * stack; a start claims before provisioning, so the two can never overlap. `waitMs` 0
 * refuses immediately, which is what a destructive command wants.
 */
function claimInstance(instance, { waitMs = 0, label = 'nd', onWait } = {}) {
  return acquireLock(instanceClaimPath(instance.registry, instance.id), { waitMs, label, onWait });
}

function releaseInstanceClaim(handle) {
  releaseLock(handle);
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
 * Read-only view for commands that must not create state (`db`, `seed`, `urls`, `stop`).
 * Falls back to the default ports when this worktree never started a stack; the
 * database names are still its own, because they are derived from the instance id.
 *
 * `applyPins: false` is for `stop`: a shell that pinned a port must still be able to
 * stop the stack the record describes, otherwise the suggested command is the one that
 * refuses to run.
 */
function peekInstance({
  worktree = ROOT,
  env = process.env,
  commonDir: injected,
  applyPins = true,
} = {}) {
  const resolved = path.resolve(worktree);
  const commonDir = injected === undefined ? gitCommonDir(resolved) : injected;
  const id = instanceId(resolved, commonDir);
  const dir = registryDir(commonDir, resolved);
  const record = readRecord(dir, id);
  assertRecordWorktree(record, resolved);
  const pins = applyPins ? pinnedPorts(env) : {};
  if (record && Object.entries(pins).some(([name, port]) => record.ports[name] !== port)) {
    throw new Error(
      `Instance '${id}' has different saved ports; stop it and start with the desired ND_*_PORT values.`
    );
  }
  const base =
    record || buildRecord({ id, worktree: resolved, ports: { ...DEFAULT_PORTS, ...pins } });
  return {
    ...base,
    registry: dir,
    commonDir,
    isMain: id === 'main',
    hasRecord: Boolean(record),
    running: liveSupervisors(base).length > 0,
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
  attachmentStorage = undefined,
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
    assertRecordWorktree(existing, resolved);
    // A record `db prune` owns must not be adopted: its databases are being dropped.
    if (existing && existing.prune && pruneClaimIsLive(existing)) {
      throw new Error(
        `Instance '${id}' is being pruned by ${describeOwner(existing.prune)}; retry when it finishes.`
      );
    }
    const { prune: _discardedPrune, ...adoptable } = existing || {};
    const live = existing && recordIsRunning(existing);
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
      ...(existing ? adoptable : buildRecord({ id, worktree: resolved, ports })),
      id,
      worktree: resolved,
      ports,
      database: databaseNames(id).database,
      yhubDatabase: databaseNames(id).yhubDatabase,
      redisPrefix: redisPrefix(id),
      ...(attachmentStorage ? { attachmentStorage } : {}),
      updatedAt: Date.now(),
    };
    writeRecord(dir, record);

    return {
      ...record,
      registry: dir,
      commonDir,
      isMain: id === 'main',
      hasRecord: true,
      running: liveSupervisors(record).length > 0,
      source: 'record',
    };
  });
}

/** The services one recorded foreground supervisor owns; unknown means all of them. */
function servicesOf(entry) {
  const stored = entry && entry.services;
  const known = Array.isArray(stored) ? SERVICE_NAMES.filter((name) => stored.includes(name)) : [];
  return known.length > 0 ? known : [...SERVICE_NAMES];
}

function liveSupervisors(record) {
  return supervisorsOf(record).filter((entry) => isPidAlive(entry && entry.pid));
}

/**
 * Services claimed by a live foreground supervisor. `./nd dev api` and `./nd dev web` in
 * separate terminals are both recorded, and only the union blocks a second start.
 */
function claimedServices(record) {
  const live = liveSupervisors(record);
  return SERVICE_NAMES.filter((name) => live.some((entry) => servicesOf(entry).includes(name)));
}

function recordIsRunning(record) {
  return liveSupervisors(record).length > 0 || Object.keys(liveServicePids(record)).length > 0;
}

/**
 * Add or replace this process's supervisor entry. Other supervisors in the worktree are
 * left alone: a second terminal's start must not erase the first one from the record.
 */
function setSupervisor(instance, pid = process.pid, services = null) {
  const record = readRecord(instance.registry, instance.id);
  if (!record) return null;
  const owned = Array.isArray(services)
    ? SERVICE_NAMES.filter((name) => services.includes(name))
    : [];
  const supervisors = record.supervisors.filter((entry) => Number(entry.pid) !== Number(pid));
  supervisors.push({
    pid: Number(pid),
    services: owned.length > 0 ? owned : null,
    startedAt: Date.now(),
  });
  return updateRecord(instance.registry, instance.id, { supervisors });
}

/** Clear only the exiting supervisor's entry. */
function clearSupervisor(instance, pid = process.pid) {
  const record = readRecord(instance.registry, instance.id);
  if (!record) return null;
  const supervisors = record.supervisors.filter((entry) => Number(entry.pid) !== Number(pid));
  if (supervisors.length === record.supervisors.length) return record;
  return updateRecord(instance.registry, instance.id, { supervisors });
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
  return updateRecord(instance.registry, instance.id, { pids: live });
}

/** Clear detached pids, keeping the ones passed in because they could not be stopped. */
function clearServicePids(instance, retained = null) {
  const pids = {};
  for (const [name, pid] of Object.entries(retained || {})) {
    if (isPidAlive(pid)) pids[name] = Number(pid);
  }
  return updateRecord(instance.registry, instance.id, { pids });
}

function liveServicePids(record) {
  const live = {};
  for (const [name, pid] of Object.entries((record && record.pids) || {})) {
    if (isPidAlive(pid)) live[name] = Number(pid);
  }
  return live;
}

// --- Stale-record claims used by `db prune` --------------------------------------

function pruneClaimIsLive(record) {
  const claim = record && record.prune;
  return Boolean(claim && isPidAlive(claim.pid));
}

/**
 * Everything a destructive command needs to agree with the record before it drops
 * anything. Derived names are checked, not trusted: a malformed or edited record must
 * never be able to name another worktree's database, and an empty Redis prefix must
 * never fall back to the invoking worktree's.
 */
function recordMetadataProblem(record) {
  if (!record || typeof record.id !== 'string' || !/^[a-z0-9_]+$/.test(record.id)) {
    return 'its id is missing or malformed';
  }
  if (record.id === 'main') return 'the main worktree is never pruned';
  const names = databaseNames(record.id);
  if (record.database !== names.database) {
    return `its database '${record.database}' is not '${names.database}'`;
  }
  if (record.yhubDatabase !== names.yhubDatabase) {
    return `its Yhub database '${record.yhubDatabase}' is not '${names.yhubDatabase}'`;
  }
  if (record.redisPrefix !== redisPrefix(record.id)) {
    return `its Redis prefix '${record.redisPrefix || ''}' is not '${redisPrefix(record.id)}'`;
  }
  return null;
}

/**
 * Take ownership of a stale record for cleanup. The caller must hold the registry lock;
 * the returned record carries a `prune` marker that `resolveInstance` refuses to adopt,
 * so a worktree recreated mid-prune cannot start against databases being dropped.
 */
function claimStaleRecord(dir, expected) {
  const current = readRecord(dir, expected.id);
  if (!current || current.id !== expected.id || current.worktree !== expected.worktree) return null;
  if (isWorktreePresent(current)) return null;
  if (pruneClaimIsLive(current)) return null;
  const claimed = {
    ...current,
    prune: {
      pid: process.pid,
      label: 'db prune',
      token: crypto.randomBytes(6).toString('hex'),
      startedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
  writeRecord(dir, claimed);
  return claimed;
}

/**
 * Release a prune claim. `remove` deletes the record once both databases and the Redis
 * prefix are confirmed gone; otherwise the record is kept so a later prune can retry.
 * The caller must hold the registry lock.
 */
function finishPruneClaim(dir, id, token, { remove = false } = {}) {
  const current = readRecord(dir, id);
  if (!current || !current.prune || current.prune.token !== token) return false;
  if (remove) {
    removeRecord(dir, id);
    return true;
  }
  const { prune: _discardedPrune, ...rest } = current;
  writeRecord(dir, { ...rest, updatedAt: Date.now() });
  return true;
}

module.exports = {
  DEFAULT_PORTS,
  PINNED_PORT_ENV,
  buildRecord,
  claimInstance,
  claimStaleRecord,
  claimedServices,
  clearServicePids,
  clearSupervisor,
  databaseNames,
  finishPruneClaim,
  gitCommonDir,
  instanceClaimOwner,
  instanceClaimPath,
  instanceId,
  isMainWorktree,
  isPidAlive,
  isWorktreePresent,
  listRecords,
  liveServicePids,
  liveSupervisors,
  peekInstance,
  pruneClaimIsLive,
  readableName,
  readRecord,
  recordIsRunning,
  recordMetadataProblem,
  redisPrefix,
  registryDir,
  releaseInstanceClaim,
  removeRecord,
  resolveInstance,
  sanitizeName,
  servicesOf,
  setServicePids,
  setSupervisor,
  supervisorsOf,
  updateRecord,
  withRegistryLock,
};
