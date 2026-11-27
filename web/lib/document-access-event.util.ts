/**
 * In-tab notice that the caller's own access to a document changed. The share
 * panel writes the grant, but `useDocument` owns the resolved level, so a
 * self-demotion has to ask that hook to re-read `/my-access`; without it the
 * editor keeps the owner-level state and writes into a socket the server now
 * treats as read-only until the page reloads.
 */
export const DOCUMENT_ACCESS_CHANGED_EVENT = 'nextdocs:document-access-changed';

export function dispatchDocumentAccessChanged(documentId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(DOCUMENT_ACCESS_CHANGED_EVENT, { detail: { documentId } }));
}

export function subscribeDocumentAccessChanged(listener: (documentId: string) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ documentId?: string } | undefined>).detail;
    if (detail?.documentId) {
      listener(detail.documentId);
    }
  };
  window.addEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, handler);
  };
}
