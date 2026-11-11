import { afterEach, describe, expect, it } from '@jest/globals';
import net from 'node:net';
import {
  connectClient,
  destroyClients,
  freePort,
  mintToken,
  newDocId,
  startFakeApi,
  startRealtime,
  waitForClose,
  waitForExit,
  waitForSynced,
  type FakeApi,
  type RealtimeProcess,
} from './helpers/harness.js';

/**
 * IT-2 and IT-3: the process lifecycle a deploy depends on. SIGTERM must drain with a
 * close frame (not vanish), and a taken port must fail loudly instead of serving nothing.
 */
describe('realtime lifecycle', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    destroyClients();
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup().catch(() => undefined)));
  });

  it('drains on SIGTERM, closes clients with 4503, and exits 0', async () => {
    const api: FakeApi = await startFakeApi();
    const server: RealtimeProcess = await startRealtime({ apiUrl: api.url });
    cleanups.push(async () => {
      await server.stop();
      await api.close();
    });

    const token = mintToken();
    api.setVerdict(token, { allowed: true, accessLevel: 'EDIT' });
    const client = connectClient(server.wsBase, newDocId(), { token });
    cleanups.push(async () => client.destroy());
    await waitForSynced(client.provider);

    const closed = waitForClose(client.provider, 10_000);
    server.child.kill('SIGTERM');

    // 4503 is Yhub's "server shutting down, reconnect elsewhere" code: a planned restart
    // must not look like a network fault to the client.
    expect((await closed).code).toBe(4503);

    const exit = await waitForExit(server.child, 10_000);
    expect(exit.code).toBe(0);
  }, 30_000);

  it('exits non-zero and names the port when the port is already in use', async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve));
    cleanups.push(async () => {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    });

    const server = await startRealtime({ port, waitForReady: false });
    cleanups.push(async () => server.stop());

    const exit = await waitForExit(server.child, 15_000);
    expect(exit.code).not.toBe(0);
    // The message has to name the port, or an operator cannot tell which listener collided.
    expect(server.output()).toContain(String(port));
  }, 30_000);
});
