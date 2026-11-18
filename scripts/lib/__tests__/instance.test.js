'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { execFileSync, spawn } = require('node:child_process');

const {
  DEFAULT_PORTS,
  claimInstance,
  claimStaleRecord,
  claimedServices,
  clearServicePids,
  clearSupervisor,
  databaseNames,
  finishPruneClaim,
  instanceClaimOwner,
  instanceId,
  isMainWorktree,
  isWorktreePresent,
  listRecords,
  liveServicePids,
  liveSupervisors,
  peekInstance,
  readableName,
  recordMetadataProblem,
  redisPrefix,
  registryDir,
  releaseInstanceClaim,
  resolveInstance,
  setServicePids,
  setSupervisor,
  updateRecord,
  withRegistryLock,
} = require('../instance');
const { allocatePorts, ephemeralPort, isPortFree } = require('../ports');
const { acquireLock, releaseLock } = require('../lock');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nd-instance-'));
}

/** A live process with a pid that is not this test runner's. */
function liveChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

function stopChild(child) {
  try {
    child.kill('SIGKILL');
  } catch {
    // Already gone.
  }
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
  assert.deepEqual(
    listRecords(instanceA.registry)
      .find((r) => r.id === instanceA.id)
      .supervisors.map((entry) => entry.pid),
    [process.pid]
  );
  clearSupervisor(instanceA, process.pid);
  assert.deepEqual(
    listRecords(instanceA.registry).find((r) => r.id === instanceA.id).supervisors,
    []
  );
});

test('a supervisor records the services it owns so a second start can be refused', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'split', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  const read = () => listRecords(instance.registry).find((entry) => entry.id === instance.id);

  setSupervisor(instance, process.pid, ['api', 'not-a-service']);
  assert.deepEqual(read().supervisors[0].services, ['api']);
  assert.deepEqual(claimedServices(read()), ['api']);

  // A record from before the service set was stored cannot say what it owns, so it is
  // read as owning the whole stack rather than silently allowing a second one.
  assert.deepEqual(claimedServices({ supervisorPid: process.pid }), ['web', 'api', 'realtime']);
});

test('two foreground supervisors are kept side by side and cleared independently', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'two-terminals', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  const read = () => listRecords(instance.registry).find((entry) => entry.id === instance.id);
  const api = liveChild();
  const web = liveChild();

  try {
    setSupervisor(instance, api.pid, ['api']);
    setSupervisor(instance, web.pid, ['web']);

    assert.deepEqual(
      read()
        .supervisors.map((entry) => entry.pid)
        .sort((left, right) => left - right),
      [api.pid, web.pid].sort((left, right) => left - right),
      'a second foreground start must not replace the first supervisor'
    );
    assert.deepEqual(liveSupervisors(read()).length, 2);
    assert.deepEqual(claimedServices(read()), ['web', 'api']);

    // One supervisor exiting keeps the other one's record intact.
    clearSupervisor(instance, api.pid);
    assert.deepEqual(
      read().supervisors.map((entry) => entry.pid),
      [web.pid]
    );
    assert.deepEqual(claimedServices(read()), ['web']);
  } finally {
    stopChild(api);
    stopChild(web);
  }
});

test('a supervisor clear waits for the registry lock instead of overwriting it', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'clear-race', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  const read = () => listRecords(instance.registry).find((entry) => entry.id === instance.id);
  const api = liveChild();
  const web = liveChild();

  try {
    setSupervisor(instance, api.pid, ['api']);
    setSupervisor(instance, web.pid, ['web']);

    // Simulate the interleaving: another process holds the registry lock while it
    // registers a supervisor. A clear that writes from its own stale read would drop
    // that registration; taking the lock makes it wait instead.
    const handle = await acquireLock(path.join(path.dirname(instance.registry), 'lock'), {
      label: 'concurrent start',
    });
    try {
      const during = clearSupervisor(instance, api.pid, { waitMs: 100 });
      assert.equal(during, null, 'a contended clear must not write');
      assert.deepEqual(
        read()
          .supervisors.map((entry) => entry.pid)
          .sort((left, right) => left - right),
        [api.pid, web.pid].sort((left, right) => left - right),
        'the record is untouched while another process owns the lock'
      );
    } finally {
      releaseLock(handle);
    }

    clearSupervisor(instance, api.pid);
    assert.deepEqual(
      read().supervisors.map((entry) => entry.pid),
      [web.pid]
    );
  } finally {
    stopChild(api);
    stopChild(web);
  }
});

test('a start that cannot record its supervisor fails before anything runs', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'set-race', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  const read = () => listRecords(instance.registry).find((entry) => entry.id === instance.id);

  const handle = await acquireLock(path.join(path.dirname(instance.registry), 'lock'), {
    label: 'db reset',
  });
  try {
    assert.throws(
      () => setSupervisor(instance, process.pid, ['api'], { waitMs: 100 }),
      /registry|another \.\/nd process/i
    );
    assert.deepEqual(read().supervisors, [], 'a refused registration must not be half-written');
  } finally {
    releaseLock(handle);
  }

  setSupervisor(instance, process.pid, ['api']);
  assert.deepEqual(
    read().supervisors.map((entry) => entry.pid),
    [process.pid]
  );
});

test('supervisors starting and exiting in parallel keep every registration', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'parallel-supervisors', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  const read = () => listRecords(instance.registry).find((entry) => entry.id === instance.id);
  const ready = path.join(tempDir(), 'ready');
  fs.mkdirSync(ready);

  // Each child registers itself, waits until all of them are recorded, then clears only
  // its own entry. A lost registration makes the barrier time out and a lost clear leaves
  // an entry behind, so both halves of the race are observable.
  const agents = 4;
  const script = `
    const fs = require('fs');
    const path = require('path');
    const { setSupervisor, clearSupervisor, listRecords } = require(${JSON.stringify(
      require.resolve('../instance')
    )});
    const [registryAndId, readyDir, expected] = process.argv.slice(1);
    const instance = JSON.parse(registryAndId);
    setSupervisor(instance, process.pid, ['api']);
    fs.writeFileSync(path.join(readyDir, String(process.pid)), '');
    const deadline = Date.now() + 8000;
    for (;;) {
      const peers = fs.readdirSync(readyDir).length;
      const record = listRecords(instance.registry).find((entry) => entry.id === instance.id);
      const live = record ? record.supervisors.filter((entry) => entry.pid !== process.pid) : [];
      if (peers >= Number(expected) && live.length >= Number(expected) - 1) break;
      if (Date.now() > deadline) process.exit(4);
    }
    clearSupervisor(instance, process.pid);
  `;
  const children = Array.from({ length: agents }, () =>
    spawn(
      process.execPath,
      [
        '-e',
        script,
        JSON.stringify({ registry: instance.registry, id: instance.id }),
        ready,
        String(agents),
      ],
      { stdio: 'ignore' }
    )
  );
  const codes = await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          child.on('close', (code) => resolve(code));
        })
    )
  );
  assert.deepEqual(codes, [0, 0, 0, 0], 'every child must see all four registrations and clear');
  assert.deepEqual(read().supervisors, [], 'a clear removes only its own entry');
});

test('detached pids are recorded, filtered by liveness, and leave supervisors alone', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'detached', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });

  setServicePids(instance, {
    api: process.pid,
    web: 2_147_483_647,
    realtime: process.pid,
  });

  const record = listRecords(instance.registry).find((entry) => entry.id === instance.id);
  assert.deepEqual(record.pids, { api: process.pid, realtime: process.pid });
  assert.deepEqual(liveServicePids(record), { api: process.pid, realtime: process.pid });

  clearServicePids(instance);
  assert.deepEqual(
    listRecords(instance.registry).find((entry) => entry.id === instance.id).pids,
    {}
  );

  // A failed stop keeps its pid in the record so a later `./nd stop` can retry it.
  clearServicePids(instance, { api: process.pid, web: 2_147_483_647 });
  assert.deepEqual(listRecords(instance.registry).find((entry) => entry.id === instance.id).pids, {
    api: process.pid,
  });
});

test('a lifecycle claim is exclusive and readable by the command that wants it', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'claim', 'nextdocs');
  fs.mkdirSync(worktree, { recursive: true });
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });

  const reset = await claimInstance(instance, { waitMs: 0, label: 'db reset' });
  assert.ok(reset, 'the first claim must succeed');
  assert.equal(await claimInstance(instance, { waitMs: 0, label: 'dev' }), null);
  assert.equal(instanceClaimOwner(instance).label, 'db reset');

  releaseInstanceClaim(reset);
  const dev = await claimInstance(instance, { waitMs: 0, label: 'dev' });
  assert.ok(dev, 'the claim must be reusable after release');
  releaseInstanceClaim(dev);
  assert.equal(instanceClaimOwner(instance), null);
});

test('a prune claim blocks adoption of a recreated worktree until it is released', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'recreated', 'nextdocs');
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });
  assert.equal(isWorktreePresent(instance), false);

  const claimed = await withRegistryLock(instance.registry, () =>
    claimStaleRecord(instance.registry, instance)
  );
  assert.ok(claimed && claimed.prune);
  assert.equal(claimed.prune.pid, process.pid);

  // The worktree is restored while prune owns the record: it must not adopt the record
  // whose databases are being dropped.
  fs.mkdirSync(worktree, { recursive: true });
  await assert.rejects(
    resolveInstance({ worktree, env: {}, commonDir: repo.commonDir }),
    /being pruned/
  );
  // A second prune cannot steal a live claim either.
  assert.equal(
    await withRegistryLock(instance.registry, () => claimStaleRecord(instance.registry, instance)),
    null
  );

  await withRegistryLock(instance.registry, () =>
    finishPruneClaim(instance.registry, instance.id, claimed.prune.token, { remove: false })
  );
  const after = listRecords(instance.registry)[0];
  assert.equal(after.prune, undefined);
  assert.deepEqual(
    (await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir })).ports,
    instance.ports
  );
});

test('stale records are validated before anything can be dropped', async () => {
  const repo = fakeRepository();
  const worktree = path.join(repo.root, 'worktrees', 'metadata', 'nextdocs');
  const instance = await resolveInstance({ worktree, env: {}, commonDir: repo.commonDir });

  assert.equal(recordMetadataProblem(instance), null);
  assert.match(recordMetadataProblem({ ...instance, redisPrefix: '' }), /Redis prefix/);
  assert.match(recordMetadataProblem({ ...instance, redisPrefix: 'yhub' }), /Redis prefix/);
  assert.match(recordMetadataProblem({ ...instance, database: 'nextdocs' }), /is not 'nextdocs_/);
  assert.match(recordMetadataProblem({ ...instance, yhubDatabase: 'nextdocs_yhub' }), /Yhub/);
  assert.match(recordMetadataProblem({ ...instance, id: 'main' }), /never pruned/);
  assert.match(recordMetadataProblem({ ...instance, id: 'Bad Id' }), /malformed/);
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
