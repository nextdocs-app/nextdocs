import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  connectClient,
  freePort,
  newDocId,
  sleep,
  waitFor,
  waitForClose,
  waitForSynced,
} from './helpers/harness.js';
import {
  DOCKER_TESTS_ENABLED,
  POSTGRES_URL,
  REDIS_URL,
  REALTIME_IMAGE,
  ROOT_DIR,
  SERVICE_TOKEN,
} from './helpers/env.js';

const docker = (args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();

function containerName(): string {
  return `nextdocs-realtime-it-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function runContainer(name: string, port: number, postgres: string): void {
  docker([
    'run',
    '-d',
    '--name',
    name,
    // The container talks to the same Postgres/Redis as the tests; host networking keeps
    // the URLs identical to the ones the suite already uses.
    '--network',
    'host',
    '-e',
    `PORT=${port}`,
    '-e',
    `POSTGRES=${postgres}`,
    '-e',
    `REDIS=${REDIS_URL}`,
    '-e',
    `API_BASE_URL=http://127.0.0.1:9`,
    '-e',
    'JWT_SECRET=integration-jwt-secret-0123456789abcdef',
    '-e',
    `YHUB_SERVICE_TOKEN=${SERVICE_TOKEN}`,
    REALTIME_IMAGE,
  ]);
}

/** Leaves the container in place: the exit code is asserted before cleanup removes it. */
function stopContainer(name: string, timeoutSeconds = 10): void {
  docker(['stop', '-t', String(timeoutSeconds), name]);
}

function removeContainer(name: string): void {
  try {
    docker(['rm', '-f', name]);
  } catch {
    // Already removed.
  }
}

function exitCodeOf(name: string): number {
  return Number(docker(['inspect', '-f', '{{.State.ExitCode}}', name]));
}

async function waitForHealthy(base: string): Promise<void> {
  await waitFor(
    async () => {
      try {
        return (await fetch(`${base}/api/ping/v1`)).ok;
      } catch {
        return false;
      }
    },
    60_000,
    `the container never became healthy at ${base}`
  );
}

/**
 * Runs a psql statement against the shared Postgres through a throwaway client container,
 * so the test does not need a database driver of its own.
 */
function psql(database: string, sql: string): string {
  const url = new URL(POSTGRES_URL);
  const password = decodeURIComponent(url.password);
  const image = process.env.POSTGRES_IMAGE ?? 'postgres:15-alpine';
  return docker([
    'run',
    '--rm',
    '--network',
    'host',
    '-e',
    `PGPASSWORD=${password}`,
    image,
    'psql',
    '-h',
    url.hostname,
    '-p',
    String(url.port || 5432),
    '-U',
    decodeURIComponent(url.username),
    '-d',
    database,
    '-tAc',
    sql,
  ]);
}

const describeDocker = DOCKER_TESTS_ENABLED ? describe : describe.skip;

/**
 * IT-4 and IT-5: the unit suite runs against a source tree, but production runs the image.
 * These assertions cover the two things the Dockerfile itself owns: PID 1 shutdown, and
 * the Yhub schema bootstrapping that `./nd` and the image both need.
 */
describeDocker('runner image', () => {
  const cleanupNames: string[] = [];

  beforeAll(() => {
    if (!fs.existsSync(path.join(ROOT_DIR, 'realtime', 'Dockerfile'))) {
      throw new Error('realtime/Dockerfile is missing');
    }
    // CI builds the image and sets REALTIME_IMAGE; a local run can build it once by hand.
    try {
      docker(['image', 'inspect', REALTIME_IMAGE]);
    } catch {
      throw new Error(
        `image ${REALTIME_IMAGE} is missing; build it with "docker build -f realtime/Dockerfile -t ${REALTIME_IMAGE} ."`
      );
    }
  }, 120_000);

  afterAll(() => {
    cleanupNames.forEach(removeContainer);
  });

  it('is PID 1 as node and stops cleanly under docker stop', async () => {
    const name = containerName();
    const port = await freePort();
    cleanupNames.push(name);
    runContainer(name, port, POSTGRES_URL);
    const base = `http://127.0.0.1:${port}`;
    await waitForHealthy(base);

    // PID 1 must be node: a shell wrapper would not receive docker stop's SIGTERM and the
    // 12s grace period would run into the forced exit. /proc/1/comm is the main thread
    // name on Node 24 ("MainThread"), so check the executable instead.
    expect(docker(['exec', name, 'readlink', '/proc/1/exe'])).toMatch(/\/node$/);

    const client = connectClient(`ws://127.0.0.1:${port}/api/ws/v1/nextdocs`, newDocId(), {
      headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    await waitForSynced(client.provider);

    const closed = waitForClose(client.provider, 20_000);
    stopContainer(name);
    expect((await closed).code).toBe(4503);

    await sleep(500);
    expect(exitCodeOf(name)).toBe(0);
    client.destroy();
  }, 120_000);

  it('bootstraps the Yhub schema on an empty database and is idempotent', async () => {
    const database = `nextdocs_yhub_it_${Date.now()}`;
    const url = new URL(POSTGRES_URL);
    url.pathname = `/${database}`;
    const postgres = url.toString();

    psql('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);

    const first = containerName();
    cleanupNames.push(first);
    const firstPort = await freePort();
    runContainer(first, firstPort, postgres);
    await waitForHealthy(`http://127.0.0.1:${firstPort}`);

    const tableCount = Number(
      psql(database, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`)
    );
    expect(tableCount).toBeGreaterThan(0);

    stopContainer(first);
    await sleep(500);
    expect(exitCodeOf(first)).toBe(0);

    // A restart over the already-initialised schema must converge instead of failing.
    const second = containerName();
    cleanupNames.push(second);
    const secondPort = await freePort();
    runContainer(second, secondPort, postgres);
    await waitForHealthy(`http://127.0.0.1:${secondPort}`);
    stopContainer(second);
    await sleep(500);
    expect(exitCodeOf(second)).toBe(0);

    psql('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  }, 180_000);
});
