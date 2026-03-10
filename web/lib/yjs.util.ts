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

export function createDefaultDocumentMeta(title?: string): DocumentMeta {
  const now = new Date().toISOString();
  return {
    title: title || 'Untitled',
    createdAt: now,
    updatedAt: now,
  };
}
