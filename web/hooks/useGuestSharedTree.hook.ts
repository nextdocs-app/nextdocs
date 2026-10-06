'use client';

import { useEffect, useRef, useState } from 'react';
import {
  documentService,
  DocumentServiceApiError,
  sanitizeDocumentAccessLevel,
} from '@/services/document.service';
import { useAppDispatch } from '@/stores/hooks';
import { useAuth } from '@/hooks/useAuth.hook';
import {
  fetchPublicChildrenThunk,
  resetTree,
  syncPublicRoots,
} from '@/stores/sharedTree/sharedTree.slice';
import type { TreeNode } from '@/types/tree.types';

/**
 * Guest (anonymous share-link) sidebar population. Authenticated users get
 * their Shared section from the document list; guests have no account, so we
 * build the visible shared hierarchy from public endpoints (which already
 * enforce effective link access, own or inherited):
 * - public breadcrumbs give the ancestor chain down to the open document,
 * - the open document's children load once so its subtree is visible;
 *   deeper levels load lazily on expand like the authenticated tree.
 */
export function useGuestSharedTree(activeDocId: string) {
  const dispatch = useAppDispatch();
  const { isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const prevAuthRef = useRef(isAuthenticated);

  useEffect(() => {
    if (prevAuthRef.current !== isAuthenticated) {
      prevAuthRef.current = isAuthenticated;
      dispatch(resetTree());
    }
  }, [isAuthenticated, dispatch]);

  useEffect(() => {
    if (isAuthenticated || !activeDocId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        const crumbs = await documentService.getDocumentBreadcrumbs(activeDocId);
        if (cancelled || crumbs.length === 0) {
          return;
        }

        const nodes: TreeNode[] = crumbs.map((crumb, index) => ({
          id: crumb.id,
          title: crumb.title || 'Untitled',
          parentId:
            crumb.parentId !== undefined ? crumb.parentId : index > 0 ? crumbs[index - 1].id : null,
          orderKey: crumb.orderKey || `public:${String(index).padStart(4, '0')}`,
          // Non-leaf chain nodes necessarily have children (the next crumb);
          // the open document's children load once below.
          hasChildren: index < crumbs.length - 1,
          effectiveAccessLevel: sanitizeDocumentAccessLevel(crumb.accessLevel, 'VIEW'),
          createdAt: crumb.createdAt ?? '',
          updatedAt: crumb.updatedAt ?? '',
        }));
        dispatch(syncPublicRoots(nodes));

        // Navigation may have landed while the chain was loading. The newer run
        // owns the tree now, and this document's children are no longer on
        // screen: fetching them would only spend the guest's per-IP request
        // budget on a level nobody is looking at.
        if (cancelled) {
          return;
        }

        try {
          await dispatch(fetchPublicChildrenThunk({ parentId: activeDocId })).unwrap();
        } catch {
          // A throttled/offline children fetch must not wipe the chain;
          // expansion retries it lazily.
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof DocumentServiceApiError && (err.status === 403 || err.status === 404)) {
          // Link revoked or never public: clear stale guest roots.
          dispatch(resetTree());
        }
        // Connectivity/429 failures keep the last good tree instead of
        // flashing an empty Shared section.
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, activeDocId, dispatch]);

  return { isGuestSharedLoading: isLoading };
}
