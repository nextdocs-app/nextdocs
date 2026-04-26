import { decodeYjsState } from './yjs.util';
import type { StoredDocument } from '@/types/document.types';

export function isUntitledTitle(title: string | undefined): boolean {
  const normalized = (title ?? '').trim().toLowerCase();
  return normalized === '' || normalized === 'untitled';
}

export function isEmptyLocalDocument(doc: StoredDocument): boolean {
  try {
    const ydoc = decodeYjsState(doc.yjsState);
    const fragment = ydoc.getXmlFragment('blocknote');
    const isEmpty = fragment.length === 0;
    ydoc.destroy();
    return isEmpty;
  } catch {
    // Keep unknown/unreadable docs eligible to avoid accidental data loss.
    return false;
  }
}
