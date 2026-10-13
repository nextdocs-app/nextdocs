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

    // Signature covers permission/relationship/order changes too: an
    // access-only change arrives with unchanged updatedAt but must still
    // refresh effectiveAccessLevel affordances in the tree. Title/icon/cover
    // edits are deliberately excluded: they fan out through updateNodeMeta
    // (Yjs meta sync + document-meta-updated, reconciled on open without a
    // refetch), and including them would rebuild all roots O(N) on every
    // keystroke or icon change. Closed shared rows going stale until opened
    // is pre-existing and accepted — icon matches title exactly here.
    const signature = documents
      .map(
        (doc) =>
          `${doc.id}:${doc.meta.updatedAt}:${doc.accessLevel ?? ''}:${doc.relationship}:${doc.orderKey ?? ''}`
      )
      .join('|');
    if (signature === lastSyncRef.current) {
      return;
    }

    lastSyncRef.current = signature;
    dispatch(syncSharedRoots(documents));
  }, [documents, dispatch, isAuthenticated]);
}
