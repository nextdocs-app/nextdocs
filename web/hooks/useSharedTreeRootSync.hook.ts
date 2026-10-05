'use client';

import { useEffect, useRef } from 'react';
import { useAppDispatch } from '@/stores/hooks';
import { useAuth } from '@/hooks/useAuth.hook';
import { syncSharedRoots } from '@/stores/sharedTree/sharedTree.slice';
import type { SharedDocumentEntry } from '@/stores/documentList/documentList.types';

/**
 * Keeps the Shared tree roots in sync with the signed-in shared-documents list.
 * Skipped while signed out: guests build their roots from public endpoints via
 * useGuestSharedTree. The signature is cleared when signed out because logout
 * (or the guest-mode transition) resets the tree, so logging back in with an
 * unchanged document list must still rebuild it.
 */
export function useSharedTreeRootSync(documents: SharedDocumentEntry[]) {
  const dispatch = useAppDispatch();
  const { isAuthenticated } = useAuth();
  const lastSyncRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      lastSyncRef.current = null;
      return;
    }

    const signature = documents.map((doc) => `${doc.id}:${doc.meta.updatedAt}`).join('|');
    if (signature === lastSyncRef.current) {
      return;
    }

    lastSyncRef.current = signature;
    dispatch(syncSharedRoots(documents));
  }, [documents, dispatch, isAuthenticated]);
}
