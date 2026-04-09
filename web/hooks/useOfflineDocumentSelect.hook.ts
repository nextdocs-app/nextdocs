import { useEffect } from 'react';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '@/lib/offline-navigation.util';

/**
 * Listens for offline document selection events and invokes a callback
 * when a document is selected while the browser is offline.
 *
 * The main reason we are doing this workaround is that Next.js App Router’s router.push()
 * triggers RSC (React Server Component) payload fetches (/_rsc endpoint), even for
 * 'use client' pages. So, we need to navigate to the document page using a custom event
 * when the user is offline, and won't route the URL to the selected document's page but the UI
 * would show the document content based on the selected document ID. So, the only problematic
 * thing is not showing the selected document's URL in the address bar, but it is an acceptable
 * trade-off for now to support offline document selection.
 *
 * TODO: Maybe there are some ways to improve this in the future, but we need to do some research
 * and experiments to find out the best solution. For now this works well as the tradeoff is not
 * going to affect the user experience much.
 */
export function useOfflineDocumentSelect(onSelect: (id: string) => void) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOfflineDocumentSelect = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string } | undefined>).detail;
      if (!detail?.id) {
        return;
      }

      onSelect(detail.id);
    };

    window.addEventListener(
      OFFLINE_DOCUMENT_SELECT_EVENT,
      handleOfflineDocumentSelect as EventListener
    );
    return () => {
      window.removeEventListener(
        OFFLINE_DOCUMENT_SELECT_EVENT,
        handleOfflineDocumentSelect as EventListener
      );
    };
  }, [onSelect]);
}
