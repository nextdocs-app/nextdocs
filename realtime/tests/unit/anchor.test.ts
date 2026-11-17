import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as Y from '@y/y';
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
  /** One text-bearing paragraph per content string, in document order. */
  blocks: Y.Node[];
};

/** Build a v14 document with one text-bearing paragraph per string. */
function buildDocument(contents: string[]): BuiltDocument {
  const ydoc = new Y.Doc();
  const root = ydoc.get('blocknote');
  const blocks: Y.Node[] = [];

  for (const content of contents) {
    const paragraph = new Y.Node('paragraph');
    paragraph.setAttr('id', crypto.randomUUID());
    paragraph.insert(0, content);
    root.insert(root.length, [paragraph]);
    blocks.push(paragraph);
  }

  return { ydoc, blocks };
}

/** A relative position on a v14 node, in the form the browser sends it. */
function relative(node: Y.Node, index: number): RelativePositionJson {
  return Y.relativePositionToJSON(
    Y.createRelativePositionFromTypeIndex(node, index)
  ) as RelativePositionJson;
}

type TextOp = { insert: string; format?: Record<string, unknown> };

/** Flatten the document's text runs in document order. */
function textOps(ydoc: Y.Doc): TextOp[] {
  const ops: TextOp[] = [];

  const walk = (node: Y.Node): void => {
    const delta = node.toDelta() as unknown as { children?: Array<TextOp> };
    for (const op of delta.children ?? []) {
      if (typeof op.insert === 'string') {
        ops.push(op);
      }
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.Node) {
        walk(child);
      }
    }
  };

  walk(ydoc.get('blocknote'));
  return ops;
}

function commentFormats(op: TextOp): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(op.format ?? {}).filter(([key]) => key.startsWith('comment'))
  );
}

/**
 * A v14 paragraph with text runs around an inline atom (“hi @Alice there”), the
 * shape `pmnodeToDelta` writes for real mentions: the text runs are characters
 * in the node's index space and the atom counts one.
 */
function mentionParagraph(): { ydoc: Y.Doc; paragraph: Y.Node; mention: Y.Node } {
  const ydoc = new Y.Doc();
  const paragraph = new Y.Node('paragraph');
  ydoc.get('blocknote').insert(0, [paragraph]);
  const mention = new Y.Node('mention');
  mention.setAttr('name', 'Alice');
  paragraph.insert(0, 'hi ');
  paragraph.insert(3, [mention]);
  paragraph.insert(4, ' there');
  return { ydoc, paragraph, mention };
}

type NodeOp = { insert: unknown; format?: Record<string, unknown> };

function nodeOps(node: Y.Node): NodeOp[] {
  const delta = node.toDelta() as unknown as { children?: Iterable<NodeOp> };
  return delta.children ? [...delta.children] : [];
}

/** The text this node carries under a comment format, in document order. */
function markedText(node: Y.Node): string {
  return nodeOps(node)
    .filter(
      (op) => typeof op.insert === 'string' && Object.keys(commentFormats(op as TextOp)).length > 0
    )
    .map((op) => op.insert)
    .join('');
}

describe('applyAnchorMark', () => {
  it('marks exactly the selected text', () => {
    const { ydoc, blocks } = buildDocument(['hello world']);

    applyAnchorMark(
      ydoc,
      { anchor: relative(blocks[0], 6), head: relative(blocks[0], 11) },
      threadId
    );

    const ops = textOps(ydoc);
    expect(ops.map((op) => op.insert)).toEqual(['hello ', 'world']);
    expect(commentFormats(ops[0])).toEqual({});
    expect(commentFormats(ops[1])).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
  });

  it('marks a v14 paragraph whose text is a string child', () => {
    // The browser's editor writes string children and indexes characters, so a
    // block is positioned directly without a separate text node.
    const ydoc = new Y.Doc();
    const paragraph = new Y.Node('paragraph');
    paragraph.insert(0, 'hello world');
    ydoc.get('blocknote').insert(0, [paragraph]);

    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 6), head: relative(paragraph, 11) },
      threadId
    );

    const delta = paragraph.toDelta() as unknown as { children?: Iterable<TextOp> };
    const ops = delta.children ? [...delta.children] : [];
    expect(ops.map((op) => op.insert)).toEqual(['hello ', 'world']);
    expect(commentFormats(ops[1])).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
  });

  it('marks text around an inline atom instead of rejecting the selection', () => {
    const { ydoc, paragraph } = mentionParagraph();
    expect(paragraph.length).toBe(10);

    // Character 3..4 is the mention: `format` and absolute indexes share the
    // node's own length, so a selection spanning it is neither stale nor short.
    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 0), head: relative(paragraph, 10) },
      threadId
    );

    const ops = nodeOps(paragraph);
    expect(ops.map((op) => (typeof op.insert === 'string' ? op.insert : 'mention'))).toEqual([
      'hi ',
      'mention',
      ' there',
    ]);
    for (const op of ops) {
      expect(commentFormats(op)).toEqual({
        [commentMarkKey(threadId)]: { orphan: false, threadId },
      });
    }
  });

  it('does not mark the atom when the selection starts after it', () => {
    const { ydoc, paragraph } = mentionParagraph();

    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 4), head: relative(paragraph, 10) },
      threadId
    );

    const [before, atom, after] = nodeOps(paragraph);
    expect(commentFormats(before)).toEqual({});
    expect(commentFormats(atom)).toEqual({});
    expect(commentFormats(after)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
  });

  it('marks the atom a selection starts on', () => {
    const { ydoc, paragraph } = mentionParagraph();

    // A selection can begin on the mention itself: the browser reports the
    // atom's own index, which is one unit of the paragraph, not the start of the
    // text that follows it.
    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 3), head: relative(paragraph, 10) },
      threadId
    );

    const [before, atom, after] = nodeOps(paragraph);
    expect(commentFormats(before)).toEqual({});
    expect(commentFormats(atom)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
    expect(commentFormats(after)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
  });

  it('marks the atom a selection ends on', () => {
    const { ydoc, paragraph } = mentionParagraph();

    // The end of a range is exclusive, so index 4 is the first position after
    // the atom and still selects it; index 3 stops short of it.
    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 0), head: relative(paragraph, 4) },
      threadId
    );

    const [before, atom, after] = nodeOps(paragraph);
    expect(commentFormats(before)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
    expect(commentFormats(atom)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
    expect(commentFormats(after)).toEqual({});
  });

  it('does not mark the atom when the selection ends before it', () => {
    const { ydoc, paragraph } = mentionParagraph();

    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 0), head: relative(paragraph, 3) },
      threadId
    );

    const [before, atom] = nodeOps(paragraph);
    expect(commentFormats(before)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
    expect(commentFormats(atom)).toEqual({});
  });

  it('marks an atom-only selection', () => {
    const { ydoc, paragraph } = mentionParagraph();

    // Selecting nothing but a mention has no text run to anchor to at all; the
    // atom's own index unit is the whole range.
    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 3), head: relative(paragraph, 4) },
      threadId
    );

    const [before, atom, after] = nodeOps(paragraph);
    expect(commentFormats(before)).toEqual({});
    expect(commentFormats(atom)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
    expect(commentFormats(after)).toEqual({});
  });

  it('marks an atom-only selection at the end of a block', () => {
    // The same selection with no text after the atom: there is no following run
    // to extend the range to, so the atom alone has to carry the mark.
    const ydoc = new Y.Doc();
    const paragraph = new Y.Node('paragraph');
    ydoc.get('blocknote').insert(0, [paragraph]);
    const mention = new Y.Node('mention');
    mention.setAttr('name', 'Alice');
    paragraph.insert(0, 'hi ');
    paragraph.insert(3, [mention]);

    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 3), head: relative(paragraph, 4) },
      threadId
    );

    const [before, atom] = nodeOps(paragraph);
    expect(commentFormats(before)).toEqual({});
    expect(commentFormats(atom)).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
  });

  it('marks a selection made on the block containers', () => {
    // The browser positions a selection that spans whole blocks on the container
    // that holds them, not on their text.
    const { ydoc, blocks } = buildDocument(['alpha', 'beta']);
    const root = ydoc.get('blocknote');

    applyAnchorMark(ydoc, { anchor: relative(root, 0), head: relative(root, 2) }, threadId);

    expect(markedText(blocks[0])).toBe('alpha');
    expect(markedText(blocks[1])).toBe('beta');
  });

  it('stops at the block boundary the selection ends on', () => {
    const { ydoc, blocks } = buildDocument(['alpha', 'beta']);
    const root = ydoc.get('blocknote');

    applyAnchorMark(ydoc, { anchor: relative(root, 0), head: relative(root, 1) }, threadId);

    expect(markedText(blocks[0])).toBe('alpha');
    expect(markedText(blocks[1])).toBe('');
  });

  it('orders a node that owns text before its own children', () => {
    // A node can hold text and child text at once. The path sort has to keep the
    // parent's run before the nested text, or a range that starts on the parent
    // and ends inside the child walks backwards and is rejected.
    const ydoc = new Y.Doc();
    const root = ydoc.get('blocknote');
    const host = new Y.Node('paragraph');
    root.insert(0, [host]);
    const inner = new Y.Node('innerNode');
    host.insert(0, ['pre ']);
    host.insert(1, [inner]);
    host.insert(2, [' post']);
    inner.insert(0, 'inner text');

    applyAnchorMark(ydoc, { anchor: relative(host, 0), head: relative(inner, 10) }, threadId);

    // The child's own text is inside the range, so it carries the mark too.
    expect(commentFormats(nodeOps(inner)[0])).toEqual({
      [commentMarkKey(threadId)]: { orphan: false, threadId },
    });
  });

  it('orders a parent’s trailing text after its nested child', () => {
    // The editor writes this shape: string runs index characters, so the text
    // after the nested node follows it in the same index space. A selection from
    // the parent's trailing run back into the nested text used to resolve
    // backwards and be rejected as a stale selection.
    const ydoc = new Y.Doc();
    const root = ydoc.get('blocknote');
    const host = new Y.Node('paragraph');
    root.insert(0, [host]);
    const inner = new Y.Node('innerNode');
    host.insert(0, 'pre ');
    host.insert(4, [inner]);
    host.insert(5, ' post');
    inner.insert(0, 'inner text');

    applyAnchorMark(ydoc, { anchor: relative(host, 7), head: relative(inner, 5) }, threadId);

    expect(markedText(inner)).toBe(' text');
    expect(markedText(host)).toBe(' p');
  });

  it('marks every text run between two paragraphs', () => {
    const { ydoc, blocks } = buildDocument(['alpha beta', 'gamma delta']);

    applyAnchorMark(
      ydoc,
      { anchor: relative(blocks[0], 6), head: relative(blocks[1], 5) },
      threadId
    );

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
    const { ydoc, blocks } = buildDocument(['hello world']);

    applyAnchorMark(
      ydoc,
      { anchor: relative(blocks[0], 11), head: relative(blocks[0], 6) },
      threadId
    );

    const marked = textOps(ydoc).filter((op) => Object.keys(commentFormats(op)).length > 0);
    expect(marked.map((op) => op.insert)).toEqual(['world']);
  });

  it.each([false, true])(
    'applies a full-block selection on block boundaries (backward: %s)',
    (backward) => {
      const { ydoc, blocks } = buildDocument(['block one', 'block two']);
      const start = relative(blocks[0], 0);
      const end = relative(blocks[1], blocks[1].length);

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
    const { ydoc, blocks } = buildDocument(['hello world']);
    const selection = {
      anchor: relative(blocks[0], 0),
      head: relative(blocks[0], 5),
    };

    applyAnchorMark(ydoc, selection, threadId);
    applyAnchorMark(ydoc, selection, threadId);

    const serialized = JSON.stringify(textOps(ydoc));
    expect(serialized.split(threadId)).toHaveLength(2);
  });

  it('rejects a relative position that no longer resolves', () => {
    const { ydoc } = buildDocument(['hello world']);
    const { blocks: otherBlocks } = buildDocument(['other document']);

    expect(() =>
      applyAnchorMark(
        ydoc,
        {
          anchor: relative(otherBlocks[0], 0),
          head: relative(otherBlocks[0], 5),
        },
        threadId
      )
    ).toThrow('Selection no longer exists');
  });

  it('rejects an empty selection', () => {
    const { ydoc, blocks } = buildDocument(['hello world']);

    expect(() =>
      applyAnchorMark(
        ydoc,
        { anchor: relative(blocks[0], 5), head: relative(blocks[0], 5) },
        threadId
      )
    ).toThrow('Selection is empty');
  });
});

describe('removeAnchorMark', () => {
  it('removes only the requested thread and leaves the text intact', () => {
    const { ydoc, blocks } = buildDocument(['hello world']);
    applyAnchorMark(
      ydoc,
      { anchor: relative(blocks[0], 0), head: relative(blocks[0], 5) },
      threadId
    );
    applyAnchorMark(
      ydoc,
      { anchor: relative(blocks[0], 6), head: relative(blocks[0], 11) },
      otherThreadId
    );

    const result = removeAnchorMark(ydoc, threadId);

    expect(result.removed).toBe(1);
    const ops = textOps(ydoc);
    expect(ops.map((op) => op.insert).join('')).toBe('hello world');
    expect(JSON.stringify(ops)).not.toContain(threadId);
    expect(JSON.stringify(ops)).toContain(otherThreadId);
  });

  it('clears a mark that starts after an inline atom', () => {
    const { ydoc, paragraph } = mentionParagraph();
    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 4), head: relative(paragraph, 10) },
      threadId
    );

    const result = removeAnchorMark(ydoc, threadId);

    // An atom contributes one index, not zero: drifting the offset by it would
    // clear the wrong characters and leave part of the mark behind.
    expect(result.removed).toBe(1);
    expect(JSON.stringify(nodeOps(paragraph))).not.toContain(threadId);
    expect(
      nodeOps(paragraph).map((op) => (typeof op.insert === 'string' ? op.insert : 'atom'))
    ).toEqual(['hi ', 'atom', ' there']);
  });

  it('clears a mark that sits on an inline atom', () => {
    const { ydoc, paragraph } = mentionParagraph();
    // The editor can put the comment mark on the mention's own insertion, not on
    // the text runs around it.
    paragraph.format(3, 1, { [commentMarkKey(threadId)]: { orphan: false, threadId } });

    const result = removeAnchorMark(ydoc, threadId);

    expect(result.removed).toBe(1);
    expect(JSON.stringify(nodeOps(paragraph))).not.toContain(threadId);
  });

  it('clears every run of a node that holds one mark', () => {
    const { ydoc, paragraph } = mentionParagraph();
    // One anchor spanning the whole paragraph is one thread's mark on three
    // insertions, and all three have to go.
    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 0), head: relative(paragraph, 10) },
      threadId
    );

    const result = removeAnchorMark(ydoc, threadId);

    expect(result.removed).toBe(3);
    expect(JSON.stringify(nodeOps(paragraph))).not.toContain(threadId);
  });

  it('clears a mark on a block that no longer holds text', () => {
    // Only an atom is left, so the block is not among the text-bearing nodes a
    // scan of the text runs would visit.
    const ydoc = new Y.Doc();
    const paragraph = new Y.Node('paragraph');
    ydoc.get('blocknote').insert(0, [paragraph]);
    const mention = new Y.Node('mention');
    mention.setAttr('name', 'Alice');
    paragraph.insert(0, [mention]);
    paragraph.format(0, 1, { [commentMarkKey(threadId)]: { orphan: false, threadId } });

    expect(removeAnchorMark(ydoc, threadId)).toEqual({ removed: 1 });
    expect(JSON.stringify(nodeOps(paragraph))).not.toContain(threadId);
  });

  it('clears a mark on a mention after its surrounding text is deleted', () => {
    const { ydoc, paragraph } = mentionParagraph();
    applyAnchorMark(
      ydoc,
      { anchor: relative(paragraph, 0), head: relative(paragraph, 10) },
      threadId
    );

    // Deleting the commented text leaves the mark on the atom alone.
    paragraph.delete(4, 6);
    paragraph.delete(0, 3);
    expect(JSON.stringify(nodeOps(paragraph))).toContain(threadId);

    expect(removeAnchorMark(ydoc, threadId)).toEqual({ removed: 1 });
    expect(JSON.stringify(nodeOps(paragraph))).not.toContain(threadId);
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
    const { ydoc, blocks } = buildDocument(['hello world']);
    global.fetch = jest.fn(async () =>
      apiReply(200, { success: true, data: { id: threadId } })
    ) as unknown as typeof fetch;

    const response = await handleAnchorCreate(
      httpRequest(ydoc, {
        body: {
          threadId,
          selection: {
            anchor: relative(blocks[0], 0),
            head: relative(blocks[0], 5),
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
    const { ydoc, blocks } = buildDocument(['hello world']);
    global.fetch = jest.fn(async () =>
      apiReply(200, { success: true, data: { id: threadId } })
    ) as unknown as typeof fetch;

    const body = {
      threadId,
      selection: {
        anchor: relative(blocks[0], 0),
        head: relative(blocks[0], 5),
      },
    };
    const request = () => httpRequest(ydoc, { docid: rateDocumentId, body });

    for (let attempt = 0; attempt < ANCHOR_RATE_LIMIT_MAX; attempt += 1) {
      await handleAnchorCreate(request());
    }

    await expect(handleAnchorCreate(request())).rejects.toThrow('Too many');
  });

  it('refuses to anchor a thread the API does not return', async () => {
    const { ydoc, blocks } = buildDocument(['hello world']);
    global.fetch = jest.fn(async () =>
      apiReply(404, { success: false, error: 'NOT_FOUND' })
    ) as unknown as typeof fetch;

    await expect(
      handleAnchorCreate(
        httpRequest(ydoc, {
          body: {
            threadId,
            selection: {
              anchor: relative(blocks[0], 0),
              head: relative(blocks[0], 5),
            },
          },
        })
      )
    ).rejects.toThrow('Comment thread not found');

    expect(JSON.stringify(textOps(ydoc))).not.toContain(threadId);
  });

  it('removes an anchor only after the API reports the thread gone', async () => {
    const { ydoc, blocks } = buildDocument(['hello world']);
    applyAnchorMark(
      ydoc,
      { anchor: relative(blocks[0], 0), head: relative(blocks[0], 5) },
      threadId
    );
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
