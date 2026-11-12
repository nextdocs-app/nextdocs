import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import {
  connectClient,
  destroyClients,
  mintToken,
  newDocId,
  startFakeApi,
  startRealtime,
  waitFor,
  waitForSynced,
  type Client,
  type FakeApi,
  type RealtimeProcess,
} from './helpers/harness.js';
import { SERVICE_TOKEN } from './helpers/env.js';

/**
 * IT-2: the anchor endpoint is a Y.Doc write granted to a read-only role, so its
 * permission gate is exactly what these tests exist to prove. The unit tests mock
 * Yhub's request object; here a real COMMENT socket-shaped caller (HTTP, no ydoc
 * write access) asks the real server to insert a mark, and the mark has to appear in
 * every other client's document.
 */

type TextRun = { insert?: unknown; attributes?: Record<string, unknown> };
type FragmentNode = Y.XmlFragment | Y.XmlElement | Y.XmlText;

/** Comment format keys (`comment--<hash>`) on every text run of the fragment. */
function commentMarks(doc: Y.Doc): string[] {
  const marks: string[] = [];

  const walk = (node: FragmentNode): void => {
    if (node instanceof Y.XmlText) {
      for (const run of node.toDelta() as TextRun[]) {
        for (const key of Object.keys(run.attributes ?? {})) {
          if (key.startsWith('comment')) {
            marks.push(JSON.stringify(run.attributes?.[key]));
          }
        }
      }
      return;
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.AbstractType) {
        walk(child as FragmentNode);
      }
    }
  };

  walk(doc.getXmlFragment('blocknote'));
  return marks;
}

function plainText(doc: Y.Doc): string {
  let text = '';
  const walk = (node: FragmentNode): void => {
    if (node instanceof Y.XmlText) {
      text += node.toString();
      return;
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.AbstractType) {
        walk(child as FragmentNode);
      }
    }
  };
  walk(doc.getXmlFragment('blocknote'));
  return text;
}

describe('comment anchor endpoint', () => {
  let api: FakeApi;
  let server: RealtimeProcess;
  let editor: Client;

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

  /** Seeds "hello world" through a real client and waits until the server has it. */
  async function seedDocument(): Promise<{ docid: string; text: Y.XmlText }> {
    const docid = newDocId();
    const editorToken = mintToken();
    api.setVerdict(editorToken, { allowed: true, accessLevel: 'EDIT' });

    editor = connectClient(server.wsBase, docid, { token: editorToken });
    await waitForSynced(editor.provider);

    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText('hello world');
    paragraph.insert(0, [text]);
    editor.doc.getXmlFragment('blocknote').insert(0, [paragraph]);

    const reader = connectClient(server.wsBase, docid, {
      headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    try {
      await waitForSynced(reader.provider);
      await waitFor(() => plainText(reader.doc) === 'hello world');
    } finally {
      reader.destroy();
    }

    return { docid, text };
  }

  /** The selection the browser would send: two Yjs relative positions, as JSON. */
  function selectionOf(text: Y.XmlText, from: number, to: number) {
    return {
      anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, from)),
      head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, to)),
    };
  }

  function anchorRequest(docid: string, token: string | null, body?: unknown): Promise<Response> {
    return fetch(`${server.base}/api/anchor/v1/nextdocs/${docid}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  }

  function anchorRemoval(docid: string, token: string | null, threadId: string): Promise<Response> {
    return fetch(
      `${server.base}/api/anchor/v1/nextdocs/${docid}?threadId=${encodeURIComponent(threadId)}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
  }

  it('inserts a comment mark for a COMMENT caller that cannot write the document', async () => {
    const { docid, text } = await seedDocument();
    const threadId = randomUUID();
    const commenterToken = mintToken();
    api.setVerdict(commenterToken, { allowed: true, accessLevel: 'COMMENT' });
    api.setThread(commenterToken, docid, threadId);

    const response = await anchorRequest(docid, commenterToken, {
      threadId,
      selection: selectionOf(text, 0, 5),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', threadId });

    // The mark is written by the service, so it also has to reach the editor's own
    // client over the normal stream: that is what makes the highlight appear.
    await waitFor(() => commentMarks(editor.doc).length === 1);
    expect(JSON.parse(commentMarks(editor.doc)[0])).toEqual({ orphan: false, threadId });
  });

  it('anchors a guest through the share link, without a bearer token', async () => {
    const { docid, text } = await seedDocument();
    const threadId = randomUUID();
    api.setAnonymousVerdict(docid, { allowed: true, accessLevel: 'COMMENT' });
    api.setThread(null, docid, threadId);

    const response = await anchorRequest(docid, null, {
      threadId,
      selection: selectionOf(text, 6, 11),
    });

    expect(response.status).toBe(200);
    await waitFor(() => commentMarks(editor.doc).length === 1);
    expect(JSON.parse(commentMarks(editor.doc)[0])).toEqual({ orphan: false, threadId });
  });

  it('denies a VIEW caller even though the thread exists', async () => {
    const { docid, text } = await seedDocument();
    const threadId = randomUUID();
    const viewerToken = mintToken();
    api.setVerdict(viewerToken, { allowed: true, accessLevel: 'VIEW' });
    api.setThread(viewerToken, docid, threadId);

    const response = await anchorRequest(docid, viewerToken, {
      threadId,
      selection: selectionOf(text, 0, 5),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(commentMarks(editor.doc)).toEqual([]);
  });

  it('refuses to anchor a thread the API does not return', async () => {
    const { docid, text } = await seedDocument();
    const threadId = randomUUID();
    const commenterToken = mintToken();
    api.setVerdict(commenterToken, { allowed: true, accessLevel: 'COMMENT' });

    const response = await anchorRequest(docid, commenterToken, {
      threadId,
      selection: selectionOf(text, 0, 5),
    });

    expect(response.status).toBe(404);
    expect(commentMarks(editor.doc)).toEqual([]);
  });

  it('removes an anchor only after the API reports the thread gone', async () => {
    const { docid, text } = await seedDocument();
    const threadId = randomUUID();
    const commenterToken = mintToken();
    api.setVerdict(commenterToken, { allowed: true, accessLevel: 'COMMENT' });
    api.setThread(commenterToken, docid, threadId);

    await anchorRequest(docid, commenterToken, {
      threadId,
      selection: selectionOf(text, 0, 5),
    });
    await waitFor(() => commentMarks(editor.doc).length === 1);

    // A live thread is untouchable, or a commenter could hide a discussion.
    const denied = await anchorRemoval(docid, commenterToken, threadId);
    expect(denied.status).toBe(409);
    expect(commentMarks(editor.doc)).toHaveLength(1);

    api.setThread(commenterToken, docid, null);
    const removed = await anchorRemoval(docid, commenterToken, threadId);
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ status: 'ok', removed: 1 });
    await waitFor(() => commentMarks(editor.doc).length === 0);
  });
});
