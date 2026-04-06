import type { DocumentAccessLevel } from '@/services/document.service';

const DOCUMENT_ACCESS_KEY_PREFIX = 'nextdocs:document-access:';
const VALID_DOCUMENT_ACCESS_LEVELS: readonly DocumentAccessLevel[] = [
  'VIEW',
  'COMMENT',
  'EDIT',
  'OWNER',
];

function getDocumentAccessStorageKey(documentId: string): string {
  return `${DOCUMENT_ACCESS_KEY_PREFIX}${documentId}`;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isDocumentAccessLevel(value: string): value is DocumentAccessLevel {
  return VALID_DOCUMENT_ACCESS_LEVELS.includes(value as DocumentAccessLevel);
}

export function readCachedDocumentAccessLevel(documentId: string): DocumentAccessLevel | null {
  if (!canUseStorage()) {
    return null;
  }

  const value = window.localStorage.getItem(getDocumentAccessStorageKey(documentId));
  return value && isDocumentAccessLevel(value) ? value : null;
}

export function writeCachedDocumentAccessLevel(
  documentId: string,
  accessLevel: DocumentAccessLevel
): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(getDocumentAccessStorageKey(documentId), accessLevel);
  } catch {
    return;
  }
}

export function clearCachedDocumentAccessLevel(documentId: string): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(getDocumentAccessStorageKey(documentId));
}
