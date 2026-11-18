'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const {
  DEFAULT_PORTS,
  clearServicePids,
  databaseNames,
  instanceId,
  isMainWorktree,
  listRecords,
  liveServicePids,
  peekInstance,
  readableName,
  redisPrefix,
  registryDir,
  resolveInstance,
  setServicePids,
  setSupervisor,
  clearSupervisor,
  supervisorServices,
  updateRecord,
} = require('../instance');
const { allocatePorts, ephemeralPort, isPortFree } = require('../ports');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nd-instance-'));
}

/** A repo whose main worktree is `<root>/nextdocs`. */
function fakeRepository() {
  const root = tempDir();
  const mainWorktree = path.join(root, 'nextdocs');
  const commonDir = path.join(mainWorktree, '.git');
  fs.mkdirSync(commonDir, { recursive: true });
  return { root, mainWorktree, commonDir };
}

test('the main worktree keeps the historical names and ports', () => {
  const repo = fakeRepository();
  fs.rmSync(repo.commonDir, { recursive: true });
  execFileSync('git', ['init', repo.mainWorktree], { stdio: 'ignore' });
  assert.equal(isMainWorktree(repo.mainWorktree, repo.commonDir), true);
  assert.equal(instanceId(repo.mainWorktree, repo.commonDir), 'main');
  assert.deepEqual(databaseNames('main'), {
    database: 'nextdocs',
    yhubDatabase: 'nextdocs_yhub',
  });
  assert.equal(redisPrefix('main'), 'yhub');
});

test('a primary checkout with a separate git directory keeps the main identity', () => {
  const root = tempDir();
  const worktree = path.join(root, 'checkout');
  const gitDir = path.join(root, 'gitdir');
  fs.mkdirSync(worktree);
  execFileSync('git', ['init', '--separate-git-dir', gitDir, worktree], { stdio: 'ignore' });
  assert.equal(peekInstance({ worktree, env: {} }).id, 'main');
  assert.equal(peekInstance({ worktree, env: {} }).database, 'nextdocs');
});

test('a linked worktree gets a readable, path-unique id and its own names', () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'copper-geyser', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });

  assert.equal(isMainWorktree(worktree, repo.commonDir), false);
  const id = instanceId(worktree, repo.commonDir);
  assert.match(id, /^copper_geyser_[0-9a-f]{4}$/);
  assert.equal(databaseNames(id).database, `nextdocs_${id}`);
  assert.equal(databaseNames(id).yhubDatabase, `nextdocs_${id}_yhub`);
  assert.equal(redisPrefix(id), `yhub_${id}`);

  // Same basename, different path -> different instance.
  const twin = path.join(repo.root, 'worktrees', 'quiet-falcon', 'nextdocs');
  fs.mkdirSync(twin, { recursive: true });
  assert.notEqual(instanceId(twin, repo.commonDir), id);
});

test('a worktree named after the repository falls back to its parent directory', () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'steady-blade', 'nextdocs');
  assert.equal(readableName(worktree, repo.commonDir), 'steady-blade');
});

test('the registry is shared through the git directory', () => {
  const repo = fakeRepository();
  assert.equal(
    registryDir(repo.commonDir, repo.mainWorktree),
    path.join(repo.commonDir, 'nextdocs', 'instances')
  );
  assert.equal(
    registryDir(null, repo.mainWorktree),
    path.join(repo.mainWorktree, '.nd', 'instances')
  );
});

test('ports prefer the familiar defaults and skip ports other instances reserved', async () => {
  const ports = await allocatePorts({
    preferred: DEFAULT_PORTS,
    reserved: [DEFAULT_PORTS.web],
    isFree: async () => true,
  });
  assert.notEqual(ports.web, DEFAULT_PORTS.web);
  assert.equal(ports.api, DEFAULT_PORTS.api);
  assert.equal(ports.realtime, DEFAULT_PORTS.realtime);
  assert.equal(new Set(Object.values(ports)).size, 3);
});

test('allocatePorts falls back to an OS port when the preferred one is busy', async () => {
  const busy = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const { port } = busy.address();

  const ports = await allocatePorts({
    preferred: { web: port, api: 0, realtime: 0 },
    isFree: isPortFree,
  });
  assert.notEqual(ports.web, port);
  assert.ok(ports.web > 0);
  await new Promise((resolve) => busy.close(resolve));
});

test('strict allocation fails loudly instead of moving a pinned port', async () => {
  await assert.rejects(
    allocatePorts({
      preferred: { web: 3000, api: 8080, realtime: 1234 },
      isFree: async (port) => port !== 8080,
      strict: true,
    }),
    /Port 8080 for api is already in use/
  );
});

test('isPortFree sees a bound port and a released one', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  assert.equal(await isPortFree(port), false);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await isPortFree(port), true);
});

test('isPortFree detects an IPv6 loopback listener', async (t) => {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '::1', resolve));
  } catch (err) {
    if (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')
      return t.skip('IPv6 unavailable');
    throw err;
  }
  try {
    assert.equal(await isPortFree(server.address().port), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the first resolution persists ports and later runs reuse them', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'agent-one', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });

  const first = await resolveInstance({
    worktree,
    env: {},
    commonDir: repo.commonDir,
  });
  assert.equal(first.source, 'record');
  assert.equal(first.registry, registryDir(repo.commonDir, worktree));

  const second = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  assert.deepEqual(second.ports, first.ports);

  const peeked = peekInstance({ worktree, env: {}, commonDir: repo.commonDir });
  assert.deepEqual(peeked.ports, first.ports);
  assert.equal(peeked.hasRecord, true);
  assert.equal(peeked.database, first.database);
});

test('--new-ports replaces the allocation instead of reusing the record', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'agent-two', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });

  const first = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });

  // Occupy the previous web port: a re-roll must move away from it.
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(first.ports.web, '127.0.0.1', resolve));

  const rerolled = await resolveInstance({
    worktree,
    newPorts: true,
    env: {},
    commonDir: repo.commonDir,
  });
  assert.notEqual(rerolled.ports.web, first.ports.web);
  await new Promise((resolve) => blocker.close(resolve));
});

test('read-only commands reject a pin that differs from saved ports', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'agent-three', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });

  const recorded = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  const pinned = recorded.ports.api === 12000 ? 12001 : 12000;
  assert.throws(
    () =>
      peekInstance({ worktree, env: { ND_API_PORT: String(pinned) }, commonDir: repo.commonDir }),
    /different saved ports/
  );
  assert.equal(
    peekInstance({ worktree, env: {}, commonDir: repo.commonDir }).ports.api,
    recorded.ports.api
  );
});

test('worktree records are listed across worktrees and supervisors are tracked', async () => {
  const repo = fakeRepository();
  const a = path.join(repo.root, 'worktrees', 'alpha', 'nextdocs');
  const b = path.join(repo.root, 'worktrees', 'beta', 'nextdocs');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });

  const instanceA = await resolveInstance({ worktree: a, env: {}, commonDir: repo.commonDir });
  await resolveInstance({ worktree: b, env: {}, commonDir: repo.commonDir });

  const records = listRecords(instanceA.registry);
  assert.equal(records.length, 2);
  assert.notDeepEqual(records[0].ports, records[1].ports);

  setSupervisor(instanceA, process.pid);
  assert.equal(
    listRecords(instanceA.registry).find((r) => r.id === instanceA.id).supervisorPid,
    process.pid
  );
  clearSupervisor(instanceA, process.pid);
  assert.equal(
    listRecords(instanceA.registry).find((r) => r.id === instanceA.id).supervisorPid,
    null
  );
});

test('a supervisor records the services it owns so a second start can be refused', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'split', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  const read = () => listRecords(instance.registry).find((entry) => entry.id === instance.id);

  setSupervisor(instance, process.pid, ['api', 'not-a-service']);
  assert.deepEqual(read().supervisorServices, ['api']);
  assert.deepEqual(supervisorServices(read()), ['api']);

  // Last starter owns the slot: a second terminal's service set replaces the first.
  setSupervisor(instance, process.pid, ['web']);
  assert.deepEqual(supervisorServices(read()), ['web']);

  // A record from before the service set was stored cannot say what it owns, so it is
  // read as owning the whole stack rather than silently allowing a second one.
  assert.deepEqual(supervisorServices({ supervisorPid: process.pid }), ['web', 'api', 'realtime']);

  // A detached stack owns the services through its pids, not through this slot.
  setServicePids(instance, { api: process.pid });
  assert.equal(read().supervisorServices, null);

  setSupervisor(instance, process.pid, ['realtime']);
  clearSupervisor(instance, process.pid);
  assert.equal(read().supervisorServices, null);
  assert.equal(read().supervisorPid, null);
});

test('detached pids are recorded, filtered by liveness, and clear the supervisor slot', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'detached', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });

  setSupervisor(instance, process.pid);
  setServicePids(instance, {
    api: process.pid,
    web: 2_147_483_647,
    realtime: process.pid,
  });

  const record = listRecords(instance.registry).find((entry) => entry.id === instance.id);
  assert.deepEqual(record.pids, { api: process.pid, realtime: process.pid });
  assert.equal(record.supervisorPid, null);
  assert.deepEqual(liveServicePids(record), { api: process.pid, realtime: process.pid });

  clearServicePids(instance);
  assert.deepEqual(
    listRecords(instance.registry).find((entry) => entry.id === instance.id).pids,
    {}
  );
});

test('a colliding worktree record is never reused', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'collision');
  fs.mkdirSync(worktree);
  const record = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  updateRecord(record.registry, record.id, { worktree: path.join(repo.root, 'other') });
  assert.throws(
    () => peekInstance({ worktree, env: {}, commonDir: repo.commonDir }),
    /another worktree/
  );
  await assert.rejects(
    resolveInstance({ worktree, env: {}, commonDir: repo.commonDir }),
    /another worktree/
  );
});

test('peekInstance never writes a record', () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'read-only', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });

  const peeked = peekInstance({ worktree, env: {}, commonDir: repo.commonDir });
  assert.equal(peeked.source, 'defaults');
  assert.equal(peeked.hasRecord, false);
  assert.equal(fs.existsSync(registryDir(repo.commonDir, worktree)), false);
  assert.deepEqual(peeked.ports, DEFAULT_PORTS);
});

test('strict allocation only pins the services that asked for a fixed port', async () => {
  const ports = await allocatePorts({
    preferred: {
      web: DEFAULT_PORTS.web,
      api: DEFAULT_PORTS.api,
      realtime: DEFAULT_PORTS.realtime,
    },
    reserved: [DEFAULT_PORTS.api],
    isFree: async () => true,
    strict: ['web'],
  });
  assert.equal(ports.web, DEFAULT_PORTS.web);
  assert.notEqual(ports.api, DEFAULT_PORTS.api);
  assert.equal(new Set(Object.values(ports)).size, 3);
});

test('a pin plus an offset above the port range names both settings', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'offset', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });

  await assert.rejects(
    resolveInstance({
      worktree,
      portOffset: 1000,
      env: { ND_WEB_PORT: '65000' },
      commonDir: repo.commonDir,
    }),
    /Port 66000 for web is outside 1-65535 \(ND_WEB_PORT=65000 plus --port-offset 1000\)/
  );
});

test('one pinned port does not make the unpinned ports strict', async () => {
  const repo = fakeRepository();
  const owner = path.join(repo.root, 'worktrees', 'owner', 'nextdocs');
  const pinner = path.join(repo.root, 'worktrees', 'pinner', 'nextdocs');
  fs.mkdirSync(owner, { recursive: true });
  fs.mkdirSync(pinner, { recursive: true });

  const first = await resolveInstance({ worktree: owner, env: {}, commonDir: repo.commonDir });
  // Simulate another worktree holding the preferred API port: the registry is what the
  // allocator consults, not the host's current listeners.
  updateRecord(first.registry, first.id, {
    ports: { ...first.ports, api: DEFAULT_PORTS.api },
  });

  const web = await ephemeralPort();
  const second = await resolveInstance({
    worktree: pinner,
    env: { ND_WEB_PORT: String(web) },
    commonDir: repo.commonDir,
  });

  assert.equal(second.ports.web, web);
  assert.notEqual(second.ports.api, DEFAULT_PORTS.api);
});

test('a sticky record rejects a pin reserved by another worktree', async () => {
  const repo = fakeRepository();
  const a = path.join(repo.root, 'worktrees', 'alpha-pin', 'nextdocs');
  const b = path.join(repo.root, 'worktrees', 'beta-pin', 'nextdocs');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });

  const first = await resolveInstance({ worktree: a, env: {}, commonDir: repo.commonDir });
  const second = await resolveInstance({ worktree: b, env: {}, commonDir: repo.commonDir });

  await assert.rejects(
    resolveInstance({
      worktree: b,
      env: { ND_API_PORT: String(first.ports.api) },
      commonDir: repo.commonDir,
    }),
    /already reserved by another worktree/
  );

  const after = peekInstance({ worktree: b, env: {}, commonDir: repo.commonDir });
  assert.equal(after.ports.api, second.ports.api);
});

test('a live stack refuses a new allocation before writing the record', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'live', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });

  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  updateRecord(instance.registry, instance.id, { supervisorPid: process.pid });

  await assert.rejects(
    resolveInstance({ worktree, newPorts: true, env: {}, commonDir: repo.commonDir }),
    /stop it before changing its ports/
  );

  const after = peekInstance({ worktree, env: {}, commonDir: repo.commonDir });
  assert.deepEqual(after.ports, instance.ports);
});

test('a checkout with a broken git entry refuses to fall back to main', async () => {
  const root = tempDir();
  const worktree = path.join(root, 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /nonexistent\n');

  await assert.rejects(
    resolveInstance({ worktree, env: {} }),
    /Refusing to fall back to the main worktree/
  );
});

test('a sticky record rejects two services pinned to the same port', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'duplicate-pin', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });

  await assert.rejects(
    resolveInstance({
      worktree,
      env: { ND_API_PORT: String(instance.ports.web) },
      commonDir: repo.commonDir,
    }),
    /is assigned to both web and api/
  );
});
