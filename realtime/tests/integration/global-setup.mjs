import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Jest loads globalSetup outside its module graph, so this file cannot use the .js -> .ts
// mapping the tests rely on. It only needs the store URLs and the build output path.

const REALTIME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT_DIR = path.resolve(REALTIME_DIR, '..');
const DIST_MAIN = path.join(REALTIME_DIR, 'dist', 'main.js');
const POSTGRES_URL =
  process.env.POSTGRES || 'postgres://nextdocs:nextdocs@localhost:5433/nextdocs_yhub';
const REDIS_URL = process.env.REDIS || 'redis://localhost:6379';

// npm hoists @y/hub to the root in this workspace; the image keeps it under /app.
const HUB_INIT_DB = [
  path.join(REALTIME_DIR, 'node_modules', '@y', 'hub', 'bin', 'init-db.js'),
  path.join(ROOT_DIR, 'node_modules', '@y', 'hub', 'bin', 'init-db.js'),
].find((candidate) => fs.existsSync(candidate));

function assertTcpReachable(host, port, name) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(3000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`${name} did not accept a connection at ${host}:${port}`));
    });
    socket.once('error', reject);
  });
}

function runNode(script) {
  const result = spawnSync(process.execPath, [script], {
    cwd: REALTIME_DIR,
    env: { ...process.env, POSTGRES: POSTGRES_URL },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(script)} failed (${result.status}): ${(
        result.stderr ||
        result.stdout ||
        ''
      ).trim()}`
    );
  }
}

/**
 * Prepares the real stores the suite talks to. Yhub's schema script is the only DDL path,
 * so it runs once here instead of in every test file.
 */
export default async function globalSetup() {
  const redis = new URL(REDIS_URL);
  const postgres = new URL(POSTGRES_URL);
  await assertTcpReachable(redis.hostname, Number(redis.port || 6379), 'Redis');
  await assertTcpReachable(postgres.hostname, Number(postgres.port || 5432), 'Postgres');

  if (!fs.existsSync(DIST_MAIN)) {
    throw new Error(
      'dist/main.js is missing; run "npm run build -w realtime" before the integration suite.'
    );
  }

  runNode(path.join(REALTIME_DIR, 'scripts', 'init-yhub-db.mjs'));
  if (!HUB_INIT_DB) {
    throw new Error('@y/hub init-db.js is missing; run npm ci at the repo root.');
  }
  runNode(HUB_INIT_DB);
}
