import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import {
  connectClient,
  destroyClients,
  mintToken,
  newDocId,
  readTextAsService,
  sleep,
  startFakeApi,
  startRealtime,
  waitFor,
  waitForClose,
  waitForSynced,
  type FakeApi,
  type RealtimeProcess,
} from './helpers/harness.js';
import { SERVICE_TOKEN } from './helpers/env.js';

/**
 * IT-1: the permission object is the write gate. Yhub drops a sync update from a
 * connection without `ydoc` write access without a log line, so these assertions read
 * the *stored* document as the service identity rather than trusting the client.
 */
describe('write gate over a socket', () => {
  let api: FakeApi;
  let server: RealtimeProcess;

  beforeAll(async () => {
    api = await startFakeApi();
    server = await startRealtime({ apiUrl: api.url });
  });

  afterEach(() => {
    destroyClients();
  });

  afterAll(async () => {
    await server.stop();
    await api.close();
  });

  it('drops VIEW sync updates while EDIT updates land', async () => {
    const docid = newDocId();
    const viewerToken = mintToken();
    api.setVerdict(viewerToken, { allowed: true, accessLevel: 'VIEW' });

    const viewer = connectClient(server.wsBase, docid, { token: viewerToken });
    await waitForSynced(viewer.provider);
    viewer.doc.getText('body').insert(0, 'viewer-write');
    await sleep(500);

    // The update reached the server and was dropped: a read-only client that writes
    // anyway must not be able to change the stored document.
    expect(await readTextAsService(server.wsBase, docid)).not.toContain('viewer-write');

    const editorToken = mintToken();
    api.setVerdict(editorToken, { allowed: true, accessLevel: 'EDIT' });
    const editor = connectClient(server.wsBase, docid, { token: editorToken });
    await waitForSynced(editor.provider);
    editor.doc.getText('body').insert(0, 'editor-write');

    await waitFor(
      async () => (await readTextAsService(server.wsBase, docid)).includes('editor-write'),
      5000,
      'an EDIT update never reached the stored document'
    );

    // The viewer is a reader, not a writer: it still receives the editor's content.
    await waitFor(
      () => viewer.doc.getText('body').toString().includes('editor-write'),
      5000,
      'the VIEW client did not receive the editor update'
    );

    viewer.destroy();
    editor.destroy();
  });

  it('lets a COMMENT socket broadcast awareness to peers', async () => {
    const docid = newDocId();
    const commenterToken = mintToken();
    const editorToken = mintToken();
    api.setVerdict(commenterToken, { allowed: true, accessLevel: 'COMMENT' });
    api.setVerdict(editorToken, { allowed: true, accessLevel: 'EDIT' });

    const commenter = connectClient(server.wsBase, docid, { token: commenterToken });
    const editor = connectClient(server.wsBase, docid, { token: editorToken });
    await Promise.all([waitForSynced(commenter.provider), waitForSynced(editor.provider)]);

    commenter.provider.awareness.setLocalStateField('user', { name: 'commenter' });

    await waitFor(
      () =>
        [...editor.provider.awareness.getStates().values()].some(
          (state) => (state as { user?: { name?: string } }).user?.name === 'commenter'
        ),
      5000,
      'COMMENT awareness never reached the peer'
    );

    commenter.destroy();
    editor.destroy();
  });

  it('denies a socket when the API reports a level outside the permission map', async () => {
    const docid = newDocId();
    const token = mintToken();
    api.setVerdict(token, { allowed: true, accessLevel: 'SUPERUSER' });

    const client = connectClient(server.wsBase, docid, { token });
    const refusals: string[] = [];
    client.provider.on('connection-error', () => refusals.push('error'));
    client.provider.on('connection-close', () => refusals.push('close'));

    // The unknown level is a contract error (503), never an implicit read grant.
    await waitFor(() => refusals.length > 0, 5000, 'the server accepted an unknown access level');
    expect(client.provider.synced).toBe(false);

    client.destroy();
  });

  it('closes a socket on the next recheck after a mid-session downgrade', async () => {
    const docid = newDocId();
    const token = mintToken();
    api.setVerdict(token, { allowed: true, accessLevel: 'EDIT' });

    const client = connectClient(server.wsBase, docid, { token });
    await waitForSynced(client.provider);

    // The user's grant is lowered while the socket stays open.
    api.setVerdict(token, { allowed: true, accessLevel: 'VIEW' });

    const response = await fetch(`${server.base}/api/recheck/v1/nextdocs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ docids: [docid] }),
    });
    expect(response.status).toBe(200);

    const closed = await waitForClose(client.provider, 5000);
    // Yhub closes a connection whose permission object changed with 4401.
    expect(closed.code).toBe(4401);

    client.destroy();
  });
});
