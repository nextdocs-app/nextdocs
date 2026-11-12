import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as Y from '@y/y';
import * as Y13 from 'yjs';
import {
  ANCHOR_RATE_LIMIT_MAX,
  applyAnchorMark,
  commentMarkKey,
  fetchThreadState,
  handleAnchorCreate,
  handleAnchorDelete,
  parseAnchorRequest,
  removeAnchorMark,
  type AnchorRequest,
  type RelativePositionJson,
} from '../../src/anchor.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const otherThreadId = '33333333-3333-4333-8333-333333333333';
const rateDocumentId = '44444444-4444-4444-8444-444444444444';

type BuiltDocument = {
  ydoc: Y.Doc;
  paragraphs: Y13.XmlElement[];
  texts: Y13.XmlText[];
};

/** Build the client-side Yjs 13 shape and hydrate it the way Yhub does. */
function buildDocument(contents: string[]): BuiltDocument {
  const source = new Y13.Doc();
  const fragment = source.getXmlFragment('blocknote');
  const paragraphs: Y13.XmlElement[] = [];
  const texts: Y13.XmlText[] = [];

  for (const content of contents) {
    const paragraph = new Y13.XmlElement('paragraph');
    paragraph.setAttribute('id', crypto.randomUUID());
    const text = new Y13.XmlText(content);
    paragraph.insert(0, [text]);
    fragment.insert(fragment.length, [paragraph]);
    paragraphs.push(paragraph);
    texts.push(text);
  }

  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, Y13.encodeStateAsUpdate(source));
  return { ydoc, paragraphs, texts };
}

function relative(type: Y13.XmlText | Y13.XmlElement, index: number): RelativePositionJson {
  return Y13.relativePositionToJSON(
    Y13.createRelativePositionFromTypeIndex(type, index)
  ) as RelativePositionJson;
}

type TextOp = { insert: string; format?: Record<string, unknown> };

/** Flatten the hydrated document's text runs in order. */
function textOps(ydoc: Y.Doc): TextOp[] {
  const root = ydoc.get('blocknote');
  const ops: TextOp[] = [];

  const walk = (node: Y.Node): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.Node)) {
        continue;
      }
      if (child.name == null) {
        const delta = child.toDelta() as unknown as { children?: Array<TextOp> };
        for (const op of delta.children ?? []) {
          if (typeof op.insert === 'string') {
            ops.push(op);
          }
        }
      } else {
        walk(child);
      }
    }
  };

  walk(root);
  return ops;
}

function commentFormats(op: TextOp): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(op.format ?? {}).filter(([key]) => key.startsWith('comment'))
  );
}

describe('applyAnchorMark', () => {
  it('marks exactly the selected text', () => {
    const { ydoc, texts } = buildDocument(['hello world']);

    applyAnchorMark(
      ydoc,
      { anchor: relative(texts[0], 6), head: relative(texts[0], 11) },
      threadId
    );

    const ops = textOps(ydoc);
    expect(ops.map((op) => op.insert)).toEqual(['hello ', 'world']);
    expect(commentFormats(ops[0])).toEqual({});
    expect(commentFormats(ops[1])).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
  });

  it('marks every text run between two paragraphs', () => {
    const { ydoc, texts } = buildDocument(['alpha beta', 'gamma delta']);

    applyAnchorMark(ydoc, { anchor: relative(texts[0], 6), head: relative(texts[1], 5) }, threadId);

    const ops = textOps(ydoc);
    const byText = (text: string): TextOp | undefined => ops.find((op) => op.insert === text);
    expect(commentFormats(byText('beta') as TextOp)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
    expect(commentFormats(byText('alpha ') as TextOp)).toEqual({});
    expect(commentFormats(byText('gamma') as TextOp)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
    expect(commentFormats(byText(' delta') as TextOp)).toEqual({});
  });

  it('normalizes a reversed selection', () => {
    const { ydoc, texts } = buildDocument(['hello world']);

    applyAnchorMark(
      ydoc,
      { anchor: relative(texts[0], 11), head: relative(texts[0], 6) },
      threadId
    );

    const marked = textOps(ydoc).filter((op) => Object.keys(commentFormats(op)).length > 0);
    expect(marked.map((op) => op.insert)).toEqual(['world']);
  });

  it.each([false, true])(
    'applies a full-block selection on block boundaries (backward: %s)',
    (backward) => {
      const { ydoc, paragraphs } = buildDocument(['block one', 'block two']);
      const start = relative(paragraphs[0], 0);
      const end = relative(paragraphs[1], 1);

      applyAnchorMark(
        ydoc,
        backward ? { anchor: end, head: start } : { anchor: start, head: end },
        threadId
      );

      const marked = textOps(ydoc).filter((op) => Object.keys(commentFormats(op)).length > 0);
      expect(marked.map((op) => op.insert)).toEqual(['block one', 'block two']);
    }
  );

  it('is idempotent when the same request is retried', () => {
    const { ydoc, texts } = buildDocument(['hello world']);
    const selection = {
      anchor: relative(texts[0], 0),
      head: relative(texts[0], 5),
    };

    applyAnchorMark(ydoc, selection, threadId);
    applyAnchorMark(ydoc, selection, threadId);

    const serialized = JSON.stringify(textOps(ydoc));
    expect(serialized.split(threadId)).toHaveLength(2);
  });

  it('rejects a relative position that no longer resolves', () => {
    const { ydoc } = buildDocument(['hello world']);
    const { texts: otherTexts } = buildDocument(['other document']);

    expect(() =>
      applyAnchorMark(
        ydoc,
        {
          anchor: relative(otherTexts[0], 0),
          head: relative(otherTexts[0], 5),
        },
        threadId
      )
    ).toThrow('Selection no longer exists');
  });

  it('rejects an empty selection', () => {
    const { ydoc, texts } = buildDocument(['hello world']);

    expect(() =>
      applyAnchorMark(
        ydoc,
        { anchor: relative(texts[0], 5), head: relative(texts[0], 5) },
        threadId
      )
    ).toThrow('Selection is empty');
  });
});

describe('removeAnchorMark', () => {
  it('removes only the requested thread and leaves the text intact', () => {
    const { ydoc, texts } = buildDocument(['hello world']);
    applyAnchorMark(ydoc, { anchor: relative(texts[0], 0), head: relative(texts[0], 5) }, threadId);
    applyAnchorMark(
      ydoc,
      { anchor: relative(texts[0], 6), head: relative(texts[0], 11) },
      otherThreadId
    );

    const result = removeAnchorMark(ydoc, threadId);

    expect(result.removed).toBe(1);
    const ops = textOps(ydoc);
    expect(ops.map((op) => op.insert).join('')).toBe('hello world');
    expect(JSON.stringify(ops)).not.toContain(threadId);
    expect(JSON.stringify(ops)).toContain(otherThreadId);
  });

  it('is a no-op when the thread has no mark', () => {
    const { ydoc } = buildDocument(['hello world']);

    expect(removeAnchorMark(ydoc, threadId)).toEqual({ removed: 0 });
  });

  it('is a no-op for an empty document', () => {
    expect(removeAnchorMark(new Y.Doc(), threadId)).toEqual({ removed: 0 });
  });
});

describe('anchor handlers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function apiReply(status: number, body: unknown, isJson = true): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!isJson) {
          throw new SyntaxError('not json');
        }
        return body;
      },
    } as Response;
  }

  function httpRequest(
    ydoc: Y.Doc,
    options: {
      body?: unknown;
      query?: Record<string, string>;
      userid?: string | null;
      docid?: string;
      headers?: Record<string, string>;
      bytes?: () => Promise<Uint8Array>;
    } = {}
  ): AnchorRequest {
    const agentTask: AnchorRequest['yhub']['agentTask'] = async (_docRef, _opts, handler) =>
      handler(ydoc);

    return {
      org: 'nextdocs',
      docid: options.docid ?? documentId,
      branch: 'main',
      params: {},
      query: options.query ?? {},
      headers: options.headers ?? {},
      authInfo: options.userid === null ? null : { userid: options.userid ?? 'user-1' },
      yhub: { agentTask },
      bytes:
        options.bytes ??
        (async () =>
          new TextEncoder().encode(options.body === undefined ? '' : JSON.stringify(options.body))),
    };
  }

  it('validates the thread, inserts the mark, and answers JSON', async () => {
    const { ydoc, texts } = buildDocument(['hello world']);
    global.fetch = jest.fn(async () =>
      apiReply(200, { success: true, data: { id: threadId } })
    ) as unknown as typeof fetch;

    const response = await handleAnchorCreate(
      httpRequest(ydoc, {
        body: {
          threadId,
          selection: {
            anchor: relative(texts[0], 0),
            head: relative(texts[0], 5),
          },
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      threadId,
      inserted: true,
    });
    expect(JSON.stringify(textOps(ydoc))).toContain(threadId);
  });

  it('rejects an oversized declared body without reading it', async () => {
    const { ydoc } = buildDocument(['hello world']);
    const bytes = jest.fn(async () => new TextEncoder().encode('{}'));

    await expect(
      handleAnchorCreate(
        httpRequest(ydoc, {
          headers: { 'content-length': String(16 * 1024 + 1) },
          bytes,
        })
      )
    ).rejects.toThrow('too large');
    expect(bytes).not.toHaveBeenCalled();
  });

  it('rejects an oversized body that arrives without a declared length', async () => {
    const { ydoc } = buildDocument(['hello world']);

    await expect(
      handleAnchorCreate(
        httpRequest(ydoc, {
          bytes: async () => new TextEncoder().encode('x'.repeat(16 * 1024 + 1)),
        })
      )
    ).rejects.toThrow('too large');
  });

  it('limits repeated anchor requests per user and document', async () => {
    const { ydoc, texts } = buildDocument(['hello world']);
    global.fetch = jest.fn(async () =>
      apiReply(200, { success: true, data: { id: threadId } })
    ) as unknown as typeof fetch;

    const body = {
      threadId,
      selection: {
        anchor: relative(texts[0], 0),
        head: relative(texts[0], 5),
      },
    };
    const request = () => httpRequest(ydoc, { docid: rateDocumentId, body });

    for (let attempt = 0; attempt < ANCHOR_RATE_LIMIT_MAX; attempt += 1) {
      await handleAnchorCreate(request());
    }

    await expect(handleAnchorCreate(request())).rejects.toThrow('Too many');
  });

  it('refuses to anchor a thread the API does not return', async () => {
    const { ydoc, texts } = buildDocument(['hello world']);
    global.fetch = jest.fn(async () =>
      apiReply(404, { success: false, error: 'NOT_FOUND' })
    ) as unknown as typeof fetch;

    await expect(
      handleAnchorCreate(
        httpRequest(ydoc, {
          body: {
            threadId,
            selection: {
              anchor: relative(texts[0], 0),
              head: relative(texts[0], 5),
            },
          },
        })
      )
    ).rejects.toThrow('Comment thread not found');

    expect(JSON.stringify(textOps(ydoc))).not.toContain(threadId);
  });

  it('removes an anchor only after the API reports the thread gone', async () => {
    const { ydoc, texts } = buildDocument(['hello world']);
    applyAnchorMark(ydoc, { anchor: relative(texts[0], 0), head: relative(texts[0], 5) }, threadId);
    global.fetch = jest.fn(async () =>
      apiReply(404, { success: false, error: 'NOT_FOUND' })
    ) as unknown as typeof fetch;

    const response = await handleAnchorDelete(httpRequest(ydoc, { query: { threadId } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      threadId,
      removed: 1,
    });
    expect(JSON.stringify(textOps(ydoc))).not.toContain(threadId);
  });

  it('answers removed zero when the document has no content', async () => {
    const ydoc = new Y.Doc();
    global.fetch = jest.fn(async () =>
      apiReply(404, { success: false, error: 'NOT_FOUND' })
    ) as unknown as typeof fetch;

    const response = await handleAnchorDelete(httpRequest(ydoc, { query: { threadId } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', threadId, removed: 0 });
  });

  it('refuses to remove an anchor while the thread still exists', async () => {
    const { ydoc } = buildDocument(['hello world']);
    global.fetch = jest.fn(async () =>
      apiReply(200, { success: true, data: { id: threadId } })
    ) as unknown as typeof fetch;

    await expect(handleAnchorDelete(httpRequest(ydoc, { query: { threadId } }))).rejects.toThrow(
      'Delete the comment thread'
    );
  });
});

describe('parseAnchorRequest', () => {
  const validSelection = {
    anchor: { item: { client: 1, clock: 2 }, tname: null, assoc: 0 },
    head: { item: { client: 1, clock: 4 }, tname: null, assoc: 0 },
  };

  it('accepts a well-formed request', () => {
    expect(parseAnchorRequest({ threadId, selection: validSelection })).toEqual({
      threadId,
      selection: validSelection,
    });
  });

  it.each([
    ['a missing body', null, 'JSON object'],
    ['a malformed thread id', { threadId: 'not-a-uuid', selection: validSelection }, 'UUID'],
    [
      'a missing selection',
      { threadId, selection: { anchor: validSelection.anchor } },
      'anchor and head',
    ],
    [
      'a malformed position',
      { threadId, selection: { anchor: {}, head: validSelection.head } },
      'anchor and head',
    ],
  ])('rejects %s', (_label, body, message) => {
    expect(() => parseAnchorRequest(body)).toThrow(message);
  });
});

describe('fetchThreadState', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function reply(status: number, body: unknown, isJson = true): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!isJson) {
          throw new SyntaxError('not json');
        }
        return body;
      },
    } as Response;
  }

  it('reports a thread that the API confirms', async () => {
    global.fetch = jest.fn(async () =>
      reply(200, { success: true, data: { id: threadId } })
    ) as unknown as typeof fetch;

    await expect(fetchThreadState(documentId, threadId, 'Bearer token')).resolves.toBe('exists');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/documents/${documentId}/threads/${threadId}`),
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer token' },
      })
    );
  });

  it('reports gone only for the API error envelope', async () => {
    global.fetch = jest.fn(async () =>
      reply(404, { success: false, error: 'NOT_FOUND' })
    ) as unknown as typeof fetch;

    await expect(fetchThreadState(documentId, threadId, undefined)).resolves.toBe('gone');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('treats a non-JSON 404 as an outage, not a deletion', async () => {
    global.fetch = jest.fn(async () => reply(404, 'not found', false)) as unknown as typeof fetch;

    await expect(fetchThreadState(documentId, threadId, undefined)).rejects.toThrow(
      'invalid not-found'
    );
  });

  it('rejects a definitive denial', async () => {
    global.fetch = jest.fn(async () => reply(403, { success: false })) as unknown as typeof fetch;

    await expect(fetchThreadState(documentId, threadId, undefined)).rejects.toThrow(
      'not accessible'
    );
  });

  it('surfaces API and transport failures as retryable 503s', async () => {
    global.fetch = jest.fn(async () => reply(500, { success: false })) as unknown as typeof fetch;
    await expect(fetchThreadState(documentId, threadId, undefined)).rejects.toThrow(
      'Comment API error (500)'
    );

    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(fetchThreadState(documentId, threadId, undefined)).rejects.toThrow(
      'Comment API unreachable'
    );
  });

  it('rejects a 200 that is not the requested thread', async () => {
    global.fetch = jest.fn(async () =>
      reply(200, { success: true, data: { id: otherThreadId } })
    ) as unknown as typeof fetch;

    await expect(fetchThreadState(documentId, threadId, undefined)).rejects.toThrow(
      'invalid response'
    );
  });
});
