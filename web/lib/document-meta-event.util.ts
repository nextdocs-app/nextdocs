import type { DocumentMeta } from '@/types/document.types';

export const DOCUMENT_META_UPDATED_EVENT = 'document-meta-updated';

export interface DocumentMetaUpdatedDetail {
  id: string;
  meta: DocumentMeta;
}

export function dispatchDocumentMetaUpdated(id: string, meta: DocumentMeta): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DocumentMetaUpdatedDetail>(DOCUMENT_META_UPDATED_EVENT, {
      detail: { id, meta },
    })
  );
}

export function subscribeDocumentMetaUpdated(
  listener: (detail: DocumentMetaUpdatedDetail) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<DocumentMetaUpdatedDetail>).detail;
    if (detail?.id) {
      listener(detail);
    }
  };
  window.addEventListener(DOCUMENT_META_UPDATED_EVENT, handler);
  return () => {
    window.removeEventListener(DOCUMENT_META_UPDATED_EVENT, handler);
  };
}
