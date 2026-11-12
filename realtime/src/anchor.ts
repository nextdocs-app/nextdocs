import crypto from 'crypto';
import { apiError } from '@y/hub';
import * as Y from '@y/y';
import { API_BASE_URL, UUID_REGEX } from './config.js';
import { jsonResponse } from './health.js';
import type {
  AnchorCreateRequest,
  AnchorSelection,
  RelativePositionJson,
} from './types/comment-anchor.js';

export type {
  AnchorCreateRequest,
  AnchorSelection,
  RelativePositionJson,
} from './types/comment-anchor.js';

/**
 * Server-generated comment anchors.
 *
 * COMMENT users are deliberately read-only on the Y.Doc. The browser cannot
 * insert the BlockNote comment mark that anchors a thread, so it sends the
 * selection as Yjs relative positions and this service, after checking that the
 * thread exists and belongs to the document, inserts the mark through
 * `agentTask`. Yhub then forwards the update to every connected client over its
 * normal stream.
 *
 * The browser never submits Yjs updates or mark attributes: only a thread id and
 * two stable positions. That keeps the trusted mutation narrow and avoids
 * validating arbitrary binary Yjs structures.
 */

/** The slice of a Yhub document request the anchor handlers use. */
export interface AnchorRequest {
  org: string;
  docid: string;
  branch: string;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  headers: Record<string, string>;
  authInfo: { userid: string; isService?: boolean } | null;
  yhub: {
    agentTask<R>(
      docRef: { org: string; docid: string; branch: string },
      opts: { author?: string },
      handler: (ydoc: Y.Doc) => R | Promise<R>
    ): Promise<R>;
  };
  /** The raw request body; the endpoint does not declare a Yhub `$body` schema. */
  bytes(): Promise<Uint8Array>;
}

/** A comment body is bounded by the API; an anchor is just two positions. */
const MAX_ANCHOR_BODY_BYTES = 16 * 1024;

/** Small per-instance guard against repeated hydrations of the same document. */
export const ANCHOR_RATE_LIMIT_MAX = 20;
const ANCHOR_RATE_LIMIT_WINDOW_MS = 60_000;

type AnchorRateBucket = { startedAt: number; count: number };
const anchorRateBuckets = new Map<string, AnchorRateBucket>();

function enforceAnchorRateLimit(req: AnchorRequest): void {
  const now = Date.now();
  const key = `${req.docid}\u0000${req.authInfo?.userid || 'anonymous'}`;
  let bucket = anchorRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= ANCHOR_RATE_LIMIT_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    anchorRateBuckets.set(key, bucket);
  }
  if (bucket.count >= ANCHOR_RATE_LIMIT_MAX) {
    throw apiError(429, 'Too many comment anchor requests');
  }
  bucket.count += 1;

  // Expired buckets are harmless, but do not let a long-lived process retain an
  // entry for every document a user has ever touched.
  if (anchorRateBuckets.size > 1000) {
    for (const [bucketKey, candidate] of anchorRateBuckets) {
      if (now - candidate.startedAt >= ANCHOR_RATE_LIMIT_WINDOW_MS) {
        anchorRateBuckets.delete(bucketKey);
      }
    }
  }
}

/**
 * The attribute key y-prosemirror uses for an overlapping mark: the mark name
 * plus an eight-character suffix. Comment marks can be nested, so a plain
 * `comment` key would let one thread's mark overwrite another's.
 *
 * The suffix only has to be stable and distinct per thread; the read side maps
 * any `comment--XXXXXXXX` key back to the `comment` mark.
 */
export function commentMarkKey(threadId: string): string {
  const digest = crypto.createHash('sha256').update(threadId, 'utf8').digest('base64');
  return `comment--${digest.slice(0, 8)}`;
}

/** The plain key and the hashed form y-prosemirror may have written earlier. */
export function isCommentMarkKey(key: string): boolean {
  return /^comment(?:--[A-Za-z0-9+/=]{8})?$/.test(key);
}

type TextEntry = {
  node: Y.Node;
  path: number[];
};

/**
 * Flatten the BlockNote fragment into text nodes in document order.
 *
 * Yjs 14 (the implementation Yhub persists) represents both XML elements and
 * text runs as `YNode`: a named node is an element, an unnamed one is text. The
 * path of child indexes gives a stable document order that can also place an
 * absolute position that landed on an element boundary.
 */
function indexTree(root: Y.Node): { texts: TextEntry[]; paths: Map<Y.Node, number[]> } {
  const texts: TextEntry[] = [];
  const paths = new Map<Y.Node, number[]>();
  paths.set(root, []);

  const walk = (node: Y.Node, path: number[]): void => {
    const children = node.toArray();
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!(child instanceof Y.Node)) {
        continue;
      }
      const childPath = [...path, index];
      paths.set(child, childPath);
      if (child.name == null) {
        texts.push({ node: child, path: childPath });
      } else {
        walk(child, childPath);
      }
    }
  };

  walk(root, []);
  return { texts, paths };
}

/** Lexicographic order of child-index paths. */
function comparePaths(a: number[], b: number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return a.length - b.length;
}

function rootOfIfPresent(ydoc: Y.Doc): Y.Node | null {
  const root = ydoc.get('blocknote');
  return root && root.length > 0 ? root : null;
}

function rootOf(ydoc: Y.Doc): Y.Node {
  const root = rootOfIfPresent(ydoc);
  if (!root) {
    throw apiError(409, 'Document content is empty');
  }
  return root;
}

function absoluteOf(ydoc: Y.Doc, position: RelativePositionJson): Y.AbsolutePosition | null {
  try {
    return Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(position as never),
      ydoc
    );
  } catch {
    // A malformed or GC'd position is a stale selection, not a server fault.
    return null;
  }
}

/**
 * Turn an absolute position into a text node plus an offset.
 *
 * A selection normally lands inside a text run, but a selection that starts or
 * ends at a block boundary resolves to the block element instead. In that case
 * the first text after the boundary (start) or the last text before it (end) is
 * the edge of the range.
 */
function resolveEndpoint(
  absolute: Y.AbsolutePosition,
  side: 'start' | 'end',
  tree: ReturnType<typeof indexTree>
): { textIndex: number; offset: number } | null {
  const direct = tree.texts.findIndex((entry) => entry.node === absolute.type);
  if (direct >= 0) {
    const length = tree.texts[direct].node.length;
    if (absolute.index < 0 || absolute.index > length) {
      return null;
    }
    return { textIndex: direct, offset: absolute.index };
  }

  const path = tree.paths.get(absolute.type);
  if (!path) {
    // The position points into a type that is no longer part of the document.
    return null;
  }
  const boundary = [...path, absolute.index];

  if (side === 'start') {
    // Equal paths are the first child at this boundary, whose text starts here.
    const next = tree.texts.findIndex((entry) => comparePaths(entry.path, boundary) >= 0);
    return next >= 0 ? { textIndex: next, offset: 0 } : null;
  }

  for (let index = tree.texts.length - 1; index >= 0; index -= 1) {
    if (comparePaths(tree.texts[index].path, boundary) < 0) {
      return { textIndex: index, offset: tree.texts[index].node.length };
    }
  }
  return null;
}

function isRelativePosition(value: unknown): value is RelativePositionJson {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const position = value as RelativePositionJson;
  const isId = (id: unknown): boolean =>
    !!id &&
    typeof id === 'object' &&
    Number.isInteger((id as { client?: unknown }).client) &&
    Number.isInteger((id as { clock?: unknown }).clock);

  return (
    isId(position.item) ||
    isId(position.type) ||
    (typeof position.tname === 'string' && position.tname.length > 0)
  );
}

export function parseAnchorRequest(body: unknown): AnchorCreateRequest {
  if (!body || typeof body !== 'object') {
    throw apiError(400, 'Anchor request must be a JSON object');
  }

  const { threadId, selection } = body as {
    threadId?: unknown;
    selection?: { anchor?: unknown; head?: unknown } | null;
  };

  if (typeof threadId !== 'string' || !UUID_REGEX.test(threadId)) {
    throw apiError(400, 'threadId must be a UUID');
  }
  if (
    !selection ||
    typeof selection !== 'object' ||
    !isRelativePosition(selection.anchor) ||
    !isRelativePosition(selection.head)
  ) {
    throw apiError(400, 'selection must contain anchor and head relative positions');
  }

  return {
    threadId,
    selection: { anchor: selection.anchor, head: selection.head },
  };
}

/**
 * Insert the BlockNote comment mark for `threadId` across the submitted range.
 *
 * The operation is idempotent: formatting an already-formatted range leaves the
 * document unchanged, so a retried request cannot duplicate the anchor. A stale
 * or GC'd relative position is rejected before anything is mutated.
 */
export function applyAnchorMark(ydoc: Y.Doc, selection: AnchorSelection, threadId: string): void {
  const root = rootOf(ydoc);
  const tree = indexTree(root);
  let startAbsolute = absoluteOf(ydoc, selection.anchor);
  let endAbsolute = absoluteOf(ydoc, selection.head);
  const startPath = startAbsolute && tree.paths.get(startAbsolute.type);
  const endPath = endAbsolute && tree.paths.get(endAbsolute.type);
  if (!startAbsolute || !endAbsolute || !startPath || !endPath) {
    throw apiError(409, 'Selection no longer exists');
  }

  // Order the positions before applying the direction-specific block boundary rules.
  if (comparePaths([...startPath, startAbsolute.index], [...endPath, endAbsolute.index]) > 0) {
    [startAbsolute, endAbsolute] = [endAbsolute, startAbsolute];
  }
  const from = resolveEndpoint(startAbsolute, 'start', tree);
  const to = resolveEndpoint(endAbsolute, 'end', tree);
  if (!from || !to) {
    throw apiError(409, 'Selection no longer exists');
  }
  if (from.textIndex === to.textIndex && from.offset === to.offset) {
    throw apiError(400, 'Selection is empty');
  }

  const key = commentMarkKey(threadId);
  let marked = false;
  for (let index = from.textIndex; index <= to.textIndex; index += 1) {
    const text = tree.texts[index].node;
    const begin = index === from.textIndex ? from.offset : 0;
    const finish = index === to.textIndex ? to.offset : text.length;
    if (begin >= finish) {
      continue;
    }
    text.format(begin, finish - begin, { [key]: { orphan: false, threadId } });
    marked = true;
  }

  if (!marked) {
    throw apiError(409, 'Selection no longer exists');
  }
}

/**
 * Remove every mark that references `threadId`.
 *
 * Called only after the API reports the thread gone, so a COMMENT user cannot
 * use it to strip a live discussion's highlight. Offsets do not move when a
 * format is removed, which is why the ranges collected before the first
 * mutation stay valid.
 */
export function removeAnchorMark(ydoc: Y.Doc, threadId: string): { removed: number } {
  const root = rootOfIfPresent(ydoc);
  if (!root) {
    return { removed: 0 };
  }
  const tree = indexTree(root);
  let removed = 0;

  for (const { node } of tree.texts) {
    const delta = node.toDelta() as unknown as {
      children?: Array<{ insert?: unknown; format?: Record<string, unknown> | null }>;
    };
    let offset = 0;
    const clears: Array<{ offset: number; length: number; keys: string[] }> = [];

    for (const op of delta.children ?? []) {
      const insert = op.insert;
      const length = typeof insert === 'string' ? insert.length : 0;
      if (typeof insert === 'string' && op.format) {
        const keys = Object.keys(op.format).filter((key) => {
          if (!isCommentMarkKey(key)) {
            return false;
          }
          const value = op.format?.[key];
          return (
            !!value &&
            typeof value === 'object' &&
            (value as { threadId?: unknown }).threadId === threadId
          );
        });
        if (keys.length > 0) {
          clears.push({ offset, length, keys });
        }
      }
      offset += length;
    }

    for (const clear of clears) {
      const formats: Record<string, null> = {};
      for (const key of clear.keys) {
        formats[key] = null;
      }
      node.format(clear.offset, clear.length, formats);
      removed += 1;
    }
  }

  return { removed };
}

/** Whether a thread exists in the API, or is already gone after a deletion. */
export type ThreadState = 'exists' | 'gone';

/**
 * Ask the API about the thread. It is the authority on both document access and
 * which document a thread belongs to, so the realtime service never trusts a
 * thread id or an author id from the browser.
 *
 * A 404 only counts as "gone" when it carries the API's error envelope: a
 * proxy's HTML 404 must not be mistaken for proof that the thread is deleted,
 * because that would let a commenter strip a live anchor during an outage.
 */
export async function fetchThreadState(
  documentId: string,
  threadId: string,
  authorization: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<ThreadState> {
  const url = `${API_BASE_URL}/api/v1/documents/${encodeURIComponent(
    documentId
  )}/threads/${encodeURIComponent(threadId)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authorization) {
    headers.Authorization = authorization;
  }

  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(3000) });
  } catch {
    throw apiError(503, 'Comment API unreachable');
  }

  if (res.status === 401 || res.status === 403) {
    throw apiError(403, 'Thread is not accessible');
  }

  if (res.status === 404) {
    const body = (await res.json().catch(() => null)) as { success?: unknown } | null;
    if (body?.success === false) {
      return 'gone';
    }
    throw apiError(503, 'Comment API returned an invalid not-found response');
  }

  if (!res.ok) {
    throw apiError(503, `Comment API error (${res.status})`);
  }

  const body = (await res.json().catch(() => null)) as {
    success?: unknown;
    data?: { id?: unknown } | null;
  } | null;
  if (body?.success !== true || body.data?.id !== threadId) {
    throw apiError(503, 'Comment API returned an invalid response');
  }
  return 'exists';
}

/** Anonymous guests and the service identity must not become Yjs authors. */
function attributionOf(req: AnchorRequest): string | undefined {
  const userid = req.authInfo?.userid;
  return userid && userid !== 'anonymous' && !req.authInfo?.isService ? userid : undefined;
}

async function readJsonBody(req: AnchorRequest): Promise<unknown> {
  const declaredLength = req.headers['content-length'] ?? req.headers['Content-Length'];
  if (declaredLength !== undefined) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > MAX_ANCHOR_BODY_BYTES) {
      throw apiError(413, 'Anchor request body is too large');
    }
  }

  const raw = await req.bytes();
  if (!raw || raw.length === 0) {
    throw apiError(400, 'Anchor request body is required');
  }
  if (raw.length > MAX_ANCHOR_BODY_BYTES) {
    throw apiError(413, 'Anchor request body is too large');
  }
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw apiError(400, 'Anchor request body must be valid JSON');
  }
}

export async function handleAnchorCreate(req: AnchorRequest): Promise<Response> {
  const body = await readJsonBody(req);
  const request = parseAnchorRequest(body);
  enforceAnchorRateLimit(req);

  // The API owns thread permissions and document ownership; it answers 200 with
  // the thread only when this caller may comment on this document.
  const state = await fetchThreadState(req.docid, request.threadId, req.headers.authorization);
  if (state === 'gone') {
    throw apiError(404, 'Comment thread not found');
  }

  await req.yhub.agentTask(
    { org: req.org, docid: req.docid, branch: req.branch },
    { author: attributionOf(req) },
    (ydoc) => applyAnchorMark(ydoc, request.selection, request.threadId)
  );

  return jsonResponse(200, { status: 'ok', threadId: request.threadId, inserted: true });
}

export async function handleAnchorDelete(req: AnchorRequest): Promise<Response> {
  const threadId = req.query.threadId;
  if (typeof threadId !== 'string' || !UUID_REGEX.test(threadId)) {
    throw apiError(400, 'threadId must be a UUID');
  }
  enforceAnchorRateLimit(req);

  // Removal is only allowed once the API says the thread is gone. The endpoint
  // grants COMMENT users the `d` bit so the author who deletes a thread's last
  // comment can clean up its mark, but a live thread is never touchable.
  const state = await fetchThreadState(req.docid, threadId, req.headers.authorization);
  if (state === 'exists') {
    throw apiError(409, 'Delete the comment thread before removing its anchor');
  }

  const result = await req.yhub.agentTask(
    { org: req.org, docid: req.docid, branch: req.branch },
    { author: attributionOf(req) },
    (ydoc) => removeAnchorMark(ydoc, threadId)
  );

  return jsonResponse(200, { status: 'ok', threadId, ...result });
}
