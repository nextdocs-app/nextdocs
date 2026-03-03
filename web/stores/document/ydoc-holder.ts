import type * as Y from 'yjs';

/**
 * Module-level singleton for the active Y.Doc instance.
 *
 * We are creating this and keeping it outside of Redux
 * to avoid storing non-serializable data in the store.
 */
let currentYDoc: Y.Doc | null = null;

export function getYDoc(): Y.Doc | null {
  return currentYDoc;
}

export function setYDoc(doc: Y.Doc | null): void {
  // Destroy the previous Y.Doc to free resources and prevent
  // stale update listeners from firing on the wrong document
  if (currentYDoc && currentYDoc !== doc) {
    currentYDoc.destroy();
  }
  currentYDoc = doc;
}
