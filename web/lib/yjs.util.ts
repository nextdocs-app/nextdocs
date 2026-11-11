import * as Y from 'yjs';
import type { DocumentMeta } from '@/types/document.types';

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
