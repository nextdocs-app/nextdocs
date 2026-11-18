import * as Y from '@y/y';
import type { DocumentMeta } from '@/types/document.types';

/**
 * String-only view over one shared Yjs 14 map.
 *
 * Yjs 14 collapsed `Y.Map`/`Y.Array`/`Y.Text` into a single `YNode`, so the
 * document meta channel is attributes on one node
 * (`getAttr`/`setAttr`/`hasAttr`/`deleteAttr`) rather than a typed map. Keeping
 * that behind this interface means the meta-sync code below does not depend on
 * the v14 node API, and an rc-level API change touches one file.
 */
export interface YjsStringMapChange {
  /** Keys whose attribute this transaction removed. */
  deleted: ReadonlySet<string>;
}

export interface YjsStringMap {
  get(key: string): string | undefined;
  has(key: string): boolean;
  set(key: string, value: string): void;
  delete(key: string): void;
  /** Returns an unsubscribe function. */
  observe(listener: (change: YjsStringMapChange) => void): () => void;
}

/**
 * The slice of a v14 `YNode` a map needs.
 *
 * `unknown` is required: `YNode`'s attribute methods are generic over the
 * node's `DeltaConf`, which `Doc.get(name)` leaves as `any`. Casting through
 * `unknown` keeps that erasure explicit instead of pretending the generic
 * declarations line up with this narrower, string-only view.
 */
interface YjsStringMapNode {
  getAttr(name: string): unknown;
  setAttr(name: string, value: unknown): unknown;
  hasAttr(name: string): boolean;
  deleteAttr(name: string): void;
  observe<F extends (event: { keysChanged: Set<string> }) => void>(listener: F): F;
  unobserve(listener: (event: { keysChanged: Set<string> }) => void): void;
}

export function getYjsStringMap(ydoc: Y.Doc, name: string): YjsStringMap {
  // `Doc.get` returns the same node for a name, so separate wrappers still read
  // and write one shared value.
  const node = ydoc.get(name) as unknown as YjsStringMapNode;

  return {
    get: (key) => {
      const value = node.getAttr(key);
      return typeof value === 'string' ? value : undefined;
    },
    has: (key) => node.hasAttr(key),
    set: (key, value) => {
      node.setAttr(key, value);
    },
    delete: (key) => {
      if (node.hasAttr(key)) {
        node.deleteAttr(key);
      }
    },
    observe: (listener) => {
      const handler = (event: { keysChanged: Set<string> }) => {
        // v14 reports changed attrs but not their action; absence after the
        // transaction is what distinguishes a delete from a set.
        const deleted = new Set<string>();
        for (const key of event.keysChanged) {
          if (!node.hasAttr(key)) {
            deleted.add(key);
          }
        }
        listener({ deleted });
      };
      node.observe(handler);
      return () => node.unobserve(handler);
    },
  };
}

export function createYjsDoc(): Y.Doc {
  return new Y.Doc();
}

export function encodeYjsState(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

export function decodeYjsState(state: Uint8Array): Y.Doc {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  return ydoc;
}

/**
 * Whether two snapshots describe the same Yjs history.
 *
 * Every client that ever wrote to a document contributes a client id to its
 * state vector, and those ids survive encoding. A local copy that came from
 * this cloud document therefore shares at least one id with it. Disjoint
 * vectors mean the copy belongs to a different incarnation of the document
 * (typically a reseeded database with new Yjs history under the same row id);
 * merging it would append a second, unrelated block tree and can leave
 * BlockNote unable to build its `doc` node.
 *
 * An empty side has no history to conflict with, so it is always safe to
 * merge: this preserves offline edits for a document whose cloud room is still
 * empty. That case is also the remaining hole in this check — a document whose
 * room is empty after a reseed (created through the API with a title but no
 * `yjsState`) has no client id to compare, so a stale pre-reset local copy is
 * merged back in and rebuilds the same second block tree. A state vector cannot
 * distinguish "this device's first edit" from "this row's previous incarnation";
 * comparing anything stronger would need the server to remember a per-row
 * history identity rather than the room contents.
 */
export function hasRelatedYjsHistory(target: Y.Doc, source: Y.Doc): boolean {
  const targetClients = Y.decodeStateVector(Y.encodeStateVector(target));
  const sourceClients = Y.decodeStateVector(Y.encodeStateVector(source));

  if (targetClients.size === 0 || sourceClients.size === 0) {
    return true;
  }

  for (const client of sourceClients.keys()) {
    if (targetClients.has(client)) {
      return true;
    }
  }

  return false;
}

/**
 * Fold one snapshot into another.
 *
 * Used when a cloud read is about to replace this device's copy: local edits that
 * never reached the socket (and so have no pending marker) are merged back first.
 * Yjs unions delete sets, so a stale local state cannot resurrect content the
 * server removed, and the provider uploads what the merge added on connect.
 */
export function mergeYjsSnapshot(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source), 'local-snapshot-merge');
}

export function createDefaultDocumentMeta(title?: string): DocumentMeta {
  const now = new Date().toISOString();
  return {
    title: title || 'Untitled',
    createdAt: now,
    updatedAt: now,
  };
}
