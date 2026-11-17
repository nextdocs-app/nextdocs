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
 * The attribute key @y/prosemirror uses for an overlapping mark: the mark name
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

/** The plain key and the hashed form @y/prosemirror can write. */
export function isCommentMarkKey(key: string): boolean {
  return /^comment(?:--[A-Za-z0-9+/=]{8})?$/.test(key);
}

/**
 * Index the document for range formatting.
 *
 * Every node gets the path of its own slot, so an absolute position (a node
 * plus an index in that node's space) sorts against every other position, and a
 * range can be split into one span per node. Only `nodes` are formatted, the
 * ones holding text of their own: formatting a container would put the mark on
 * its children's items instead of on its text. A block whose only content is an
 * atom therefore has no anchor range, while a mark already on that atom is
 * still cleared by `removeAnchorMark`.
 */
function indexTree(root: Y.Node): {
  nodes: Array<{ node: Y.Node; path: number[] }>;
  paths: Map<Y.Node, number[]>;
} {
  const nodes: Array<{ node: Y.Node; path: number[] }> = [];
  const paths = new Map<Y.Node, number[]>();
  paths.set(root, []);

  const walk = (node: Y.Node, path: number[]): void => {
    const children = node.toArray();
    // Yjs 14 has two index spaces: text inserted as strings indexes characters,
    // while content inserted as arrays indexes array items. `format` and
    // absolute positions follow whichever space built the content.
    const characterLength = children.reduce(
      (total, child) => total + (typeof child === 'string' ? child.length : 1),
      0
    );
    const characters = node.length === characterLength;
    let offset = 0;
    let carriesText = false;

    for (const child of children) {
      if (typeof child === 'string') {
        if (!carriesText) {
          carriesText = true;
          nodes.push({ node, path });
        }
        offset += characters ? child.length : 1;
      } else if (child instanceof Y.Node) {
        const childPath = [...path, offset];
        paths.set(child, childPath);
        walk(child, childPath);
        offset += 1;
      }
    }
  };

  walk(root, []);
  return { nodes, paths };
}

/**
 * The position as `[...node path, index]`. A child occupies one index unit, so
 * a slot starts at its own path and a position inside the child extends it. That
 * makes plain lexicographic order the document order for positions and slots
 * alike, which is what the span rules below rely on.
 */
function positionKey(
  tree: ReturnType<typeof indexTree>,
  absolute: Y.AbsolutePosition | null
): number[] | null {
  if (!absolute || absolute.index < 0 || absolute.index > absolute.type.length) {
    // A malformed position, or one that points past the end of a type the
    // document no longer has.
    return null;
  }
  const path = tree.paths.get(absolute.type);
  // The position names a type that is no longer part of the document.
  return path ? [...path, absolute.index] : null;
}

function isStrictPrefix(prefix: number[], path: number[]): boolean {
  return prefix.length < path.length && prefix.every((value, index) => value === path[index]);
}

/**
 * Where the range begins inside a node that starts at `path`, or null when the
 * node is entirely before the range.
 *
 * A node starting at or after the range's first position is inside it from its
 * own beginning — that is the block-boundary case, where the selection starts on
 * the container and the first block is already selected. When the position is
 * inside the node instead, the range enters it at that depth's offset.
 */
function spanStart(path: number[], from: number[]): number | null {
  if (comparePaths(from, path) <= 0) {
    return 0;
  }
  return isStrictPrefix(path, from) ? from[path.length] : null;
}

/**
 * Where the range ends inside a node of `length` that starts at `path`, or null
 * when the node is entirely after the range. The mirror of `spanStart`: a node
 * starting exactly at the range's last position is not selected, because the
 * range ends before its first index.
 */
function spanEnd(path: number[], to: number[], length: number): number | null {
  if (isStrictPrefix(path, to)) {
    return to[path.length];
  }
  return comparePaths(to, path) > 0 ? length : null;
}

/** Lexicographic order of index-space paths. */
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
  const start = positionKey(tree, absoluteOf(ydoc, selection.anchor));
  const end = positionKey(tree, absoluteOf(ydoc, selection.head));
  if (!start || !end) {
    throw apiError(409, 'Selection no longer exists');
  }

  // A selection can be dragged backwards.
  const [from, to] = comparePaths(start, end) > 0 ? [end, start] : [start, end];
  if (comparePaths(from, to) === 0) {
    throw apiError(400, 'Selection is empty');
  }

  // One span per node, in the node's own index space. An inline atom (mention,
  // image) sits between two text runs of the same node, so a span that covers
  // the gap covers the atom too: the browser's node selection over a mention is
  // exactly such a one-unit span.
  const key = commentMarkKey(threadId);
  let marked = false;
  for (const { node, path } of tree.nodes) {
    const begin = spanStart(path, from);
    const finish = spanEnd(path, to, node.length);
    if (begin === null || finish === null || begin >= finish) {
      continue;
    }
    node.format(begin, finish - begin, { [key]: { orphan: false, threadId } });
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

  // Every node, not just the ones holding text: a block whose text was deleted
  // around a mention keeps the mark on the mention itself.
  for (const node of tree.paths.keys()) {
    const delta = node.toDelta() as unknown as {
      children?: Array<{ insert?: unknown; format?: Record<string, unknown> | null }>;
    };
    let offset = 0;
    const clears: Array<{ offset: number; length: number; keys: string[] }> = [];

    for (const op of delta.children ?? []) {
      const insert = op.insert;
      // The offset has to advance in the same index space `format` uses: a text
      // run counts its characters, an inserted child (mention, image, …) counts
      // one. Counting an atom as zero drifts every following range.
      const length =
        typeof insert === 'string' ? insert.length : Array.isArray(insert) ? insert.length : 0;
      // Comment marks can sit on an inline atom (mention, image) as well as on a
      // text run, so every insertion that carries a format has to be inspected.
      if (op.format) {
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
  // Yhub buffers the whole body before a handler runs, so this cap only bounds
  // what is parsed, not what the process holds. The deployment must reject an
  // oversized upload at the ingress (reverse proxy / load balancer) with a
  // request-body limit; this check is the in-process backstop.
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
