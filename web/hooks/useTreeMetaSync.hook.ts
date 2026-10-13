'use client';

import { useEffect } from 'react';
import type { AppDispatch } from '@/stores/store';
import { subscribeDocumentMetaUpdated } from '@/lib/document-meta-event.util';
import type { DocumentIcon } from '@/types/document.types';

/**
 * Shared live title/icon fan-out for the sidebar trees.
 *
 * Both `SidebarTree` (private) and `SharedTree` carried an identical
 * `subscribeDocumentMetaUpdated` handler that dispatches their slice's
 * `updateNodeMeta`. One hook keeps the payload mapping in a single place so
 * the trees cannot drift (e.g. one sanitizing while the other does not —
 * sanitization itself lives in `applyNodeMeta`).
 *
 * The icon is passed through untouched, including its `undefined`; `?? null`
 * here would turn every title-only fan-out into an icon write, which makes
 * `applyNodeMeta` re-normalize and JSON-compare the icon on each keystroke.
 * Normalization to explicit null belongs to the tree boundary that already
 * owns it.
 */
export function useTreeMetaSync(
  dispatch: AppDispatch,
  updateNodeMeta: (payload: { id: string; title?: string; icon?: DocumentIcon | null }) => {
    type: string;
  }
): void {
  useEffect(() => {
    return subscribeDocumentMetaUpdated((detail) => {
      dispatch(
        updateNodeMeta({
          id: detail.id,
          title: detail.meta?.title,
          icon: detail.meta?.icon,
        })
      );
    });
  }, [dispatch, updateNodeMeta]);
}
