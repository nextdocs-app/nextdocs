'use client';

import { useCallback } from 'react';
import type * as Y from 'yjs';
import { documentService, iconCoverPatch } from '@/services/document.service';
import {
  sanitizeDocumentCover,
  sanitizeDocumentIcon,
  toCoverRequestPayload,
  toIconRequestPayload,
  type CoverRequestPayload,
  type IconRequestPayload,
} from '@/lib/document-icon.util';
import {
  determineMetaWriteRoute,
  mirrorIconCoverToYjs,
  persistMetaWrite,
  revertIconCoverInYjs,
} from '@/lib/document-meta-sync.util';
import { dispatchDocumentMetaUpdated } from '@/lib/document-meta-event.util';
import { incrementPendingSyncEdits, mergePendingIconCoverPatch } from '@/lib/offline-sync.util';
import { isReadOnlyAccessLevel } from '@/lib/realtime.util';
import type { AppDispatch } from '@/stores/store';
import { updateMeta as updateMetaAction } from '@/stores/document/document.slice';
import type { DocumentAccessLevel } from '@/services/document.service';
import type { DocumentMeta } from '@/types/document.types';

export interface DocumentIconCoverDeps {
  dispatch: AppDispatch;
  resolvedDocumentId: string;
  isAuthenticated: boolean;
  accessToken: string | null;
  isOnline: boolean;
  isSharedDocument: boolean;
  isCloudMetadataInBackoff: () => boolean;
  clearCloudMetadataBackoff: () => void;
  triggerCloudMetadataBackoff: () => void;
  /** Silent re-auth when a write hits an expired access token. */
  refreshSession: () => void;
  metaRef: React.MutableRefObject<DocumentMeta | null>;
  ydocRef: React.MutableRefObject<Y.Doc | null>;
  accessLevelRef: React.MutableRefObject<DocumentAccessLevel | null>;
  updateMetaSeqRef: React.MutableRefObject<number>;
  lastLocalIconRef: React.MutableRefObject<string | null | undefined>;
  lastLocalCoverRef: React.MutableRefObject<string | null | undefined>;
}

/**
 * Page icon/cover writes for the open document.
 *
 * Extracted from `useDocument` so the 9-concept hook delegates the whole
 * icon/cover pipeline. Persists through the shared `persistMetaWrite`
 * dispatcher — the same one `updateMeta` uses — so the title and icon/cover
 * pipelines cannot drift on backoff/fallback/rollback behavior.
 */
export function useDocumentIconCover(deps: DocumentIconCoverDeps) {
  const {
    dispatch,
    resolvedDocumentId,
    isAuthenticated,
    accessToken,
    isOnline,
    isSharedDocument,
    isCloudMetadataInBackoff,
    clearCloudMetadataBackoff,
    triggerCloudMetadataBackoff,
    refreshSession,
    metaRef,
    ydocRef,
    accessLevelRef,
    updateMetaSeqRef,
    lastLocalIconRef,
    lastLocalCoverRef,
  } = deps;

  /**
   * Writes the page icon/cover. Shares `updateMeta`'s shape — optimistic
   * dispatch, fan-out to the sidebar/breadcrumbs, durable write, rollback on
   * failure — but goes through the icon/cover endpoints, which need an explicit
   * null payload to clear a value (an absent one means "leave unchanged").
   */
  const commitIconCover = useCallback(
    (
      apply: (meta: DocumentMeta) => DocumentMeta,
      buildPatch: () => { icon?: IconRequestPayload; cover?: CoverRequestPayload }
    ) => {
      const currentMeta = metaRef.current;
      if (!currentMeta) {
        console.warn('Cannot update page icon/cover: meta is null');
        return;
      }

      if (isReadOnlyAccessLevel(accessLevelRef.current)) {
        console.warn('Cannot update page icon/cover: document is read-only');
        return;
      }

      // Shares the title's write sequence so a stale failure can never roll
      // back a newer page-metadata write.
      const seq = updateMetaSeqRef.current + 1;
      updateMetaSeqRef.current = seq;

      const previousMeta = { ...currentMeta };
      const appliedMeta = apply(currentMeta);

      // Sanitize once before fan-out: picker output mirrors into Yjs before REST
      // validates, so unsanitized values would reach peers and local render.
      // Changed-but-invalid values are dropped (the update is ignored) rather
      // than clearing a good value or mirroring garbage; unchanged stale values
      // that no longer validate are cleared.
      const sanitizedIcon = appliedMeta.icon ? sanitizeDocumentIcon(appliedMeta.icon) : undefined;
      const sanitizedCover = appliedMeta.cover
        ? sanitizeDocumentCover(appliedMeta.cover)
        : undefined;
      const iconChanged =
        JSON.stringify(appliedMeta.icon ?? null) !== JSON.stringify(previousMeta.icon ?? null);
      const coverChanged =
        JSON.stringify(appliedMeta.cover ?? null) !== JSON.stringify(previousMeta.cover ?? null);
      if (iconChanged && appliedMeta.icon !== undefined && sanitizedIcon === undefined) {
        console.warn('Ignoring invalid page icon update: sanitization rejected the value.');
        return;
      }
      if (coverChanged && appliedMeta.cover !== undefined && sanitizedCover === undefined) {
        console.warn('Ignoring invalid page cover update: sanitization rejected the value.');
        return;
      }
      const updatedMeta: DocumentMeta = {
        ...appliedMeta,
        icon: sanitizedIcon,
        cover: sanitizedCover,
      };
      // Previous JSON for a full undo: the optimistic mirror already reached
      // peers, so a server rejection must restore Yjs as well as Redux.
      // Re-sanitized so a stale pre-validation payload never rebroadcasts
      // garbage (the observer would ignore it, but peers should not see the
      // transaction at all).
      const prevIcon = previousMeta.icon ? (sanitizeDocumentIcon(previousMeta.icon) ?? null) : null;
      const prevCover = previousMeta.cover
        ? (sanitizeDocumentCover(previousMeta.cover) ?? null)
        : null;
      const prevIconJson = prevIcon ? JSON.stringify(prevIcon) : null;
      const prevCoverJson = prevCover ? JSON.stringify(prevCover) : null;

      dispatch(
        updateMetaAction({
          icon: updatedMeta.icon,
          cover: updatedMeta.cover,
          updatedAt: updatedMeta.updatedAt,
        })
      );
      dispatchDocumentMetaUpdated(resolvedDocumentId, updatedMeta);

      // Mirror icon/cover into the shared Yjs map for instant cross-client
      // sync, parallel to the title mirror in updateMeta. The map observer
      // ignores this echo, and remote applies never write back, so no loop
      // is possible. REST below remains the durable persist.
      mirrorIconCoverToYjs(
        ydocRef.current,
        updatedMeta.icon ? JSON.stringify(updatedMeta.icon) : null,
        updatedMeta.cover ? JSON.stringify(updatedMeta.cover) : null,
        lastLocalIconRef,
        lastLocalCoverRef
      );

      const persistLocalMetadata = async () => {
        await documentService.updateMetadata(resolvedDocumentId, {
          icon: updatedMeta.icon,
          cover: updatedMeta.cover,
        });
        documentService.emitLocalDocumentsChanged();
      };

      const queuePendingSync = () => {
        if (isAuthenticated && accessToken) {
          incrementPendingSyncEdits(resolvedDocumentId);
        }
      };

      // The counter alone cannot replay a clear: a cleared icon is absent from the
      // queued meta, and the API reads an absent icon as "leave unchanged". The
      // explicit patch travels with it so the reconnect can send the same
      // `{ type: null }` payload the online path sends.
      const queuePendingPatch = () => {
        if (isAuthenticated && accessToken) {
          mergePendingIconCoverPatch(resolvedDocumentId, patch);
        }
      };

      const route = determineMetaWriteRoute({
        isAuthenticated,
        accessToken,
        isOnline,
        isSharedDocument,
        isPublicLinkDocument: documentService.isPublicLinkDocument(resolvedDocumentId),
        accessLevel: accessLevelRef.current,
        inBackoff: isCloudMetadataInBackoff(),
      });
      const cloudToken = route.canCloud ? accessToken : null;

      // Rebuild the PATCH from the sanitized meta so Yjs, Redux, IndexedDB, and
      // REST all carry the same safe values (the closure over picker output may
      // hold unsanitized values). Single builder: `iconCoverPatch` owns the
      // null-vs-absent shape, so this never drifts from it.
      const rawPatch = buildPatch();
      const patch = iconCoverPatch({
        ...('icon' in rawPatch ? { icon: updatedMeta.icon ?? null } : {}),
        ...('cover' in rawPatch ? { cover: updatedMeta.cover ?? null } : {}),
      });
      const remoteWrite = cloudToken
        ? documentService.updateCloudIconCover(resolvedDocumentId, patch, cloudToken)
        : route.canPublic
          ? documentService.updatePublicIconCover(resolvedDocumentId, patch)
          : null;

      persistMetaWrite({
        remoteWrite,
        mirrorRemote: persistLocalMetadata,
        persistLocal: persistLocalMetadata,
        queuePendingSync,
        queuePendingPatch,
        triggerBackoff: triggerCloudMetadataBackoff,
        clearBackoff: clearCloudMetadataBackoff,
        refreshSession,
        rollback: () => {
          if (updateMetaSeqRef.current === seq) {
            // Spread alone omits absent keys, which would leave an optimistic
            // add in place; pass icon/cover explicitly so rolling back an add
            // clears it (explicit undefined) rather than keeping it.
            dispatch(
              updateMetaAction({
                ...previousMeta,
                icon: previousMeta.icon,
                cover: previousMeta.cover,
                updatedAt: previousMeta.updatedAt,
              })
            );
            // Local trees/breadcrumbs only listen to the fan-out event, so
            // they need it too — otherwise the local sidebar keeps the
            // rejected icon even though the header was fixed.
            dispatchDocumentMetaUpdated(resolvedDocumentId, previousMeta);
            // Undo everywhere, not just locally: the optimistic Yjs mirror
            // already broadcast the rejected value to collaborators.
            revertIconCoverInYjs(
              ydocRef.current,
              prevIconJson,
              prevCoverJson,
              lastLocalIconRef,
              lastLocalCoverRef
            );
          }
        },
        logScope: 'page icon/cover update',
      });
    },
    [
      dispatch,
      resolvedDocumentId,
      isAuthenticated,
      accessToken,
      isOnline,
      isCloudMetadataInBackoff,
      clearCloudMetadataBackoff,
      triggerCloudMetadataBackoff,
      refreshSession,
      isSharedDocument,
      metaRef,
      ydocRef,
      accessLevelRef,
      updateMetaSeqRef,
      lastLocalIconRef,
      lastLocalCoverRef,
    ]
  );

  const updateIcon = useCallback(
    (icon: DocumentMeta['icon'] | null) => {
      commitIconCover(
        (current) => ({
          ...current,
          icon: icon ?? undefined,
          updatedAt: new Date().toISOString(),
        }),
        () => ({ icon: toIconRequestPayload(icon ?? null) })
      );
    },
    [commitIconCover]
  );

  const updateCover = useCallback(
    (cover: DocumentMeta['cover'] | null) => {
      commitIconCover(
        (current) => ({
          ...current,
          cover: cover ?? undefined,
          updatedAt: new Date().toISOString(),
        }),
        () => ({ cover: toCoverRequestPayload(cover ?? null) })
      );
    },
    [commitIconCover]
  );

  return { commitIconCover, updateIcon, updateCover };
}
