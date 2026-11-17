import { ensureMemberSession, ensureOwnerSession } from './support/api';
import { API_URL, REALTIME_URL, WEB_URL } from './support/config';

const READY_TIMEOUT_MS = 60_000;

async function waitForService(name: string, url: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = 'no response';

  while (Date.now() < deadline) {
    try {
      // A service can accept the connection and then stall before sending
      // headers; bound each probe by what is left of the deadline so the setup
      // fails instead of hanging the whole run.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `${name} is not reachable at ${url} (${lastError}).\n` +
      'Start the full stack first: ./nd dev (with the E2E database), then rerun.'
  );
}

/**
 * Fails fast when the stack is down, then seeds the account every suite uses.
 * Documents are created per test from `createDocument`, so no shared document
 * exists to be mutated by a previous run.
 */
export default async function globalSetup(): Promise<void> {
  await Promise.all([
    waitForService('API', `${API_URL}/api/v1/instance/status`),
    waitForService('web', `${WEB_URL}/login`),
    waitForService('realtime', `${REALTIME_URL}/api/health/v1`),
  ]);

  await ensureOwnerSession();
  await ensureMemberSession();
}
