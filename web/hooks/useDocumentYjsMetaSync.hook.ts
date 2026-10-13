'use client';

import { useEffect } from 'react';
import type * as Y from 'yjs';
import { normalizeDocumentTitle } from '@/lib/document-content.util';
import { sanitizeDocumentCover, sanitizeDocumentIcon } from '@/lib/document-icon.util';
import {
  YJS_META_COVER_KEY,
  YJS_META_ICON_KEY,
  YJS_META_MAP_KEY,
  YJS_META_TITLE_KEY,
} from '@/lib/document-meta-sync.util';
import { dispatchDocumentMetaUpdated } from '@/lib/document-meta-event.util';
import { isReadOnlyAccessLevel } from '@/lib/realtime.util';
import type { AppDispatch } from '@/stores/store';
import { updateMeta as updateMetaAction } from '@/stores/document/document.slice';
import type { DocumentAccessLevel } from '@/services/document.service';
import type { DocumentMeta } from '@/types/document.types';

export interface DocumentYjsMetaSyncRefs {
  accessLevelRef: React.MutableRefObject<DocumentAccessLevel | null>;
  accessResolvedRef: React.MutableRefObject<boolean>;
  metaRef: React.MutableRefObject<DocumentMeta | null>;
  lastLocalTitleRef: React.MutableRefObject<string | null>;
  lastLocalIconRef: React.MutableRefObject<string | null | undefined>;
  lastLocalCoverRef: React.MutableRefObject<string | null | undefined>;
  resolvedDocumentIdRef: React.MutableRefObject<string>;
}

/**
 * Live title/icon/cover sync across collaborators via the shared Yjs `meta` map.
 *
 * Extracted from `useDocument`: local edits write the map in
 * updateMeta/commitIconCover, and remote Yjs updates land here through the map
 * observer — applied to Redux + the document-meta-updated fan-out (sidebar
 * trees, document lists, breadcrumbs) without re-writing Yjs or re-PATCHing
 * REST.
 */
export function useDocumentYjsMetaSync({
  ydoc,
  resolvedDocumentId,
  meta,
  accessLevel,
  accessResolved,
  dispatch,
  refs,
}: {
  ydoc: Y.Doc | null;
  resolvedDocumentId: string;
  meta: DocumentMeta | null;
  accessLevel: DocumentAccessLevel | null;
  accessResolved: boolean;
  dispatch: AppDispatch;
  refs: DocumentYjsMetaSyncRefs;
}): void {
  const {
    accessLevelRef,
    accessResolvedRef,
    metaRef,
    lastLocalTitleRef,
    lastLocalIconRef,
    lastLocalCoverRef,
    resolvedDocumentIdRef,
  } = refs;

  // Seed the map for documents created before Yjs meta sync existed, so
  // late joiners receive the current values over the live channel. Runs on
  // the meta values (not just ydoc) so a late REST load still seeds. Gates on
  // the resolved ref — `accessLevel` state starts null (reads as writable),
  // so gating on state lets VIEW/COMMENT clients emit writes the server
  // drops — and skips read-only clients for the same reason.
  // The seeder is create-only (`has()`): it never overwrites or deletes.
  // Deletions are owned exclusively by the map observer below, which reacts
  // to actual delete transactions. This split keeps two late joiners from
  // racing a seed against a delete and re-creating a removed key.
  useEffect(() => {
    if (!ydoc || !resolvedDocumentId) {
      return;
    }
    if (!accessResolvedRef.current) {
      return;
    }
    if (isReadOnlyAccessLevel(accessLevelRef.current)) {
      return;
    }
    const seedTitle = meta?.title;
    if (seedTitle === undefined) {
      return;
    }
    try {
      const metaMap = ydoc.getMap<string>(YJS_META_MAP_KEY);
      if (!metaMap.has(YJS_META_TITLE_KEY)) {
        metaMap.set(YJS_META_TITLE_KEY, normalizeDocumentTitle(seedTitle));
      }
      // Seed only sanitized values: `meta` may hold a stale IndexedDB payload
      // written before validation hardened.
      if (meta?.icon && !metaMap.has(YJS_META_ICON_KEY)) {
        const safeIcon = sanitizeDocumentIcon(meta.icon);
        if (safeIcon) {
          metaMap.set(YJS_META_ICON_KEY, JSON.stringify(safeIcon));
        }
      }
      if (meta?.cover && !metaMap.has(YJS_META_COVER_KEY)) {
        const safeCover = sanitizeDocumentCover(meta.cover);
        if (safeCover) {
          metaMap.set(YJS_META_COVER_KEY, JSON.stringify(safeCover));
        }
      }
    } catch (err) {
      console.warn('Failed to seed Yjs meta:', err);
    }
    // `meta?.title/icon/cover` values (not the object) so a late REST load
    // still seeds; `accessLevel/accessResolved` re-run the gate once the
    // level resolves. Refs are stable and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, resolvedDocumentId, meta?.title, meta?.icon, meta?.cover, accessLevel, accessResolved]);

  useEffect(() => {
    if (!ydoc || !resolvedDocumentId) {
      return;
    }

    const metaMap = ydoc.getMap<string>(YJS_META_MAP_KEY);

    // The observer owns deletions: a missing key is only treated as a remote
    // delete when this transaction actually deleted it (`changes.keys`), not
    // when the key was simply never set. Mere absence (`get() === undefined`)
    // conflates the two — e.g. a title-only transaction would read as an icon
    // delete for a client whose icon was never seeded — and two late joiners
    // racing a seed against such a phantom delete re-create the key. Creation
    // belongs to the seeder above (`has()` create-only); this observer only
    // deletes on real delete transactions (plus applies string updates).
    const observer = (event: Y.YMapEvent<string>) => {
      let nextTitle: string | null = null;
      let nextIcon: DocumentMeta['icon'] | null | undefined = undefined;
      let iconChanged = false;
      let nextCover: DocumentMeta['cover'] | null | undefined = undefined;
      let coverChanged = false;

      const yjsTitle = metaMap.get(YJS_META_TITLE_KEY);
      if (typeof yjsTitle === 'string') {
        // Hand-crafted EDIT writes can carry blank titles; honor the same
        // Untitled invariant as local edits and the API.
        const normalizedTitle = normalizeDocumentTitle(yjsTitle);
        const localTitle = metaRef.current?.title;
        // Local echo (our own updateMeta wrote the map) or duplicate delivery:
        // already applied, nothing to do. The last-written title is checked as
        // well because the observer runs before metaRef observes the render.
        if (normalizedTitle !== localTitle && normalizedTitle !== lastLocalTitleRef.current) {
          nextTitle = normalizedTitle;
        }
      }

      const yjsIconRaw = metaMap.get(YJS_META_ICON_KEY);
      if (typeof yjsIconRaw === 'string') {
        try {
          const sanitized = sanitizeDocumentIcon(JSON.parse(yjsIconRaw));
          if (sanitized) {
            const remoteJson = JSON.stringify(sanitized);
            const localIcon = metaRef.current?.icon;
            const localJson = localIcon
              ? JSON.stringify(sanitizeDocumentIcon(localIcon) ?? localIcon)
              : null;
            if (remoteJson !== localJson && remoteJson !== lastLocalIconRef.current) {
              nextIcon = sanitized;
              iconChanged = true;
            }
          }
          // Invalid payloads are ignored: never apply garbage to the DOM.
        } catch {
          // Unparseable payloads are ignored like invalid ones.
        }
      } else if (event.changes.keys.get(YJS_META_ICON_KEY)?.action === 'delete') {
        // A real delete transaction for this key. Our own deletion echo
        // (guard is null, metaRef not yet committed) is a no-op; a remote
        // deletion of a locally present icon wins. Never-set keys never reach
        // here (no delete transaction), so the seeder stays the sole creator.
        if (lastLocalIconRef.current !== null && metaRef.current?.icon !== undefined) {
          nextIcon = null;
          iconChanged = true;
        }
      }
      // Absent without a delete transaction (never set) or non-string values
      // (hand-crafted garbage): ignored. The seeder owns creation.

      const yjsCoverRaw = metaMap.get(YJS_META_COVER_KEY);
      if (typeof yjsCoverRaw === 'string') {
        try {
          const sanitized = sanitizeDocumentCover(JSON.parse(yjsCoverRaw));
          if (sanitized) {
            const remoteJson = JSON.stringify(sanitized);
            const localCover = metaRef.current?.cover;
            const localJson = localCover
              ? JSON.stringify(sanitizeDocumentCover(localCover) ?? localCover)
              : null;
            if (remoteJson !== localJson && remoteJson !== lastLocalCoverRef.current) {
              nextCover = sanitized;
              coverChanged = true;
            }
          }
        } catch {
          // Unparseable payloads are ignored like invalid ones.
        }
      } else if (event.changes.keys.get(YJS_META_COVER_KEY)?.action === 'delete') {
        if (lastLocalCoverRef.current !== null && metaRef.current?.cover !== undefined) {
          nextCover = null;
          coverChanged = true;
        }
      }
      // Absent without a delete transaction (never set) or non-string values:
      // ignored for the same ownership reason as the icon key above.

      if (nextTitle === null && !iconChanged && !coverChanged) {
        return;
      }
      if (!metaRef.current) {
        return;
      }
      // The remote values won: drop the echo guards so a later remote revert
      // to our old values is applied instead of mistaken for our own echo.
      if (nextTitle !== null) {
        lastLocalTitleRef.current = null;
      }
      if (iconChanged) {
        lastLocalIconRef.current = undefined;
      }
      if (coverChanged) {
        lastLocalCoverRef.current = undefined;
      }
      const updatedAt = new Date().toISOString();
      const nextMeta = {
        ...metaRef.current,
        ...(nextTitle !== null ? { title: nextTitle } : {}),
        ...(iconChanged ? { icon: nextIcon ?? undefined } : {}),
        ...(coverChanged ? { cover: nextCover ?? undefined } : {}),
        updatedAt,
      };
      dispatch(
        updateMetaAction({
          ...(nextTitle !== null ? { title: nextTitle } : {}),
          ...(iconChanged ? { icon: nextIcon ?? undefined } : {}),
          ...(coverChanged ? { cover: nextCover ?? undefined } : {}),
          updatedAt,
        })
      );
      dispatchDocumentMetaUpdated(resolvedDocumentIdRef.current, nextMeta);
    };

    metaMap.observe(observer);
    return () => {
      metaMap.unobserve(observer);
    };
  }, [
    ydoc,
    resolvedDocumentId,
    dispatch,
    metaRef,
    lastLocalTitleRef,
    lastLocalIconRef,
    lastLocalCoverRef,
    resolvedDocumentIdRef,
  ]);
}
