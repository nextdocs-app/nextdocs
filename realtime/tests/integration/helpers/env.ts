import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REALTIME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ROOT_DIR = path.resolve(REALTIME_DIR, '..');
export const DIST_MAIN = path.join(REALTIME_DIR, 'dist', 'main.js');

/** Secrets only have to be consistent between the spawned server and the test. */
export const JWT_SECRET = process.env.JWT_SECRET ?? 'integration-jwt-secret-0123456789abcdef';
export const SERVICE_TOKEN =
  process.env.YHUB_SERVICE_TOKEN ?? 'integration-service-token-0123456789abcdef';

/** Real Postgres and Redis: the suite is meaningless against fakes. */
export const POSTGRES_URL =
  process.env.POSTGRES ?? 'postgres://nextdocs:nextdocs@localhost:5433/nextdocs_yhub';
export const REDIS_URL = process.env.REDIS ?? 'redis://localhost:6379';

/** Docker tests are opt-in; the service tests are not. */
export const REALTIME_IMAGE = process.env.REALTIME_IMAGE ?? 'nextdocs-realtime:it';
export const DOCKER_TESTS_ENABLED = process.env.DOCKER_TESTS === '1';

export function redisHostPort(): { host: string; port: number } {
  const url = new URL(REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379) };
}
