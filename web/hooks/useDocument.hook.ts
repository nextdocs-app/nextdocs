import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import type { DocumentAccessLevel } from '@/services/document.service';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import {
  setCurrentDocument,
  setLoading,
  setError,
  clearDocument,
  updateMeta as updateMetaAction,
} from '@/stores/document/document.slice';
import { setYDoc } from '@/stores/document/ydoc-holder';
import { useAuth } from '@/hooks/useAuth.hook';
import { useCloudBackoff } from '@/hooks/useCloudBackoff.hook';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';
import { backoffMsFor, isConnectivityError } from '@/lib/cloud-connectivity.util';
import {
  clearCachedDocumentAccessLevel,
  readCachedDocumentAccessLevel,
  writeCachedDocumentAccessLevel,
} from '@/lib/document-access.util';
import { isReadOnlyAccessLevel } from '@/lib/realtime.util';
import { incrementPendingSyncEdits, readPendingSyncEdits } from '@/lib/offline-sync.util';
import { isRealtimeEligibleDocumentId } from '@/lib/document-id.util';
import { getRealtimeUrl } from '@/lib/api-url.util';
import { normalizeDocumentTitle } from '@/lib/document-content.util';
import { dispatchDocumentMetaUpdated } from '@/lib/document-meta-event.util';
import type { DocumentLoadResult, DocumentMeta } from '@/types/document.types';
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
const MESSAGE_ACCESS_LEVEL = 2;
const VALID_DOCUMENT_ACCESS_LEVELS: readonly DocumentAccessLevel[] = [
  'VIEW',
  'COMMENT',
  'EDIT',
  'OWNER',
];
// Yjs-shared document title: `ydoc.getMap('meta').get('title')` is the live
// transport for title edits. REST PATCH remains the durable source of truth
// for lists/trees; Yjs carries the keystroke-instant cross-client update.
const YJS_META_MAP_KEY = 'meta';
const YJS_META_TITLE_KEY = 'title';

class OfflineDocumentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineDocumentUnavailableError';
  }
}

export interface DocumentErrorState {
  kind: 'restricted' | 'generic';
  title: string;
  description: string;
  statusCode: number | null;
  responseMessage: string | null;
}

export interface UseDocumentOptions {
  isSharedDocument?: boolean;
}

function buildDocumentErrorState(error: unknown): DocumentErrorState {
  if (error instanceof OfflineDocumentUnavailableError) {
    return {
      kind: 'generic',
      title: 'Document unavailable offline',
      description:
        'This document is not available in local cache yet. Open it once while connected so it can be edited offline.',
      statusCode: null,
      responseMessage: error.message,
    };
  }

  if (error instanceof DocumentServiceApiError && (error.status === 403 || error.status === 404)) {
    return {
      kind: 'restricted',
      title: 'Access to this document has been restricted',
      description:
        'This document may have been moved to trash, removed, or your permissions changed. Content is hidden for your account safety.',
      statusCode: error.status,
      responseMessage: error.message,
    };
  }

  if (error instanceof DocumentServiceApiError) {
    return {
      kind: 'generic',
      title: 'Unable to open this document',
      description: 'The server returned an unexpected response while loading this document.',
      statusCode: error.status,
      responseMessage: error.message,
    };
  }

  return {
    kind: 'generic',
    title: 'Unable to open this document',
    description: 'An unexpected error occurred while loading this document.',
    statusCode: null,
    responseMessage: error instanceof Error ? error.message : null,
  };
}

function decodeStringFromBuffer(data: ArrayBuffer, offset: number): string {
  if (offset < 0 || offset >= data.byteLength) {
    throw new Error('decodeStringFromBuffer: offset is out of bounds for provided buffer.');
  }

  // Simple varint decoder for the length prefix
  const view = new DataView(data, offset);
  let pos = 0;
  let length = 0;
  let shift = 0;

  while (true) {
    if (pos >= view.byteLength) {
      throw new Error(
        'decodeStringFromBuffer: reached end of buffer while decoding varint length.'
      );
    }

    const byte = view.getUint8(pos);
    length += (byte & 0x7f) * 2 ** shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;

    if (shift > 35) {
      throw new Error('decodeStringFromBuffer: invalid varint length, shift exceeded safe bounds.');
    }
  }

  if (offset + pos + length > data.byteLength) {
    throw new Error(
      'decodeStringFromBuffer: decoded string length exceeds available buffer bytes.'
    );
  }

  // Extract the string
  const bytes = new Uint8Array(data, offset + pos, length);
  return new TextDecoder().decode(bytes);
}

function isValidDocumentAccessLevel(value: string): value is DocumentAccessLevel {
  return VALID_DOCUMENT_ACCESS_LEVELS.includes(value as DocumentAccessLevel);
}

function resolveAuthenticatedFallbackAccessLevel(
  documentId: string,
  options: {
    currentAccessLevel: DocumentAccessLevel | null;
    isSharedDocument: boolean;
  }
): DocumentAccessLevel {
  return (
    readCachedDocumentAccessLevel(documentId) ??
    options.currentAccessLevel ??
    (options.isSharedDocument ? 'VIEW' : 'EDIT')
  );
}

async function resolveGuestAccessLevel(
  documentId: string,
  fallback: DocumentAccessLevel = 'VIEW'
): Promise<DocumentAccessLevel> {
  try {
    const access = await documentService.checkAccess(documentId);
    if (access.allowed && access.accessLevel) {
      return access.accessLevel;
    }
  } catch {
    // Fall through to cached/fallback level so offline guests keep reading.
  }
  return readCachedDocumentAccessLevel(documentId) ?? fallback;
}

async function resolveLocalFallbackDocument(
  id: string,
  options: { createIfMissing: boolean }
): Promise<{ id: string; result: DocumentLoadResult }> {
  const localById = await documentService.loadDocument(id);
  if (localById) {
    return { id, result: localById };
  }

  if (!options.createIfMissing) {
    throw new OfflineDocumentUnavailableError('This document is not available in local cache.');
  }

  return {
    id,
    result: await documentService.getOrCreateDocument(id),
  };
}

export function useDocument(documentId: string, options?: UseDocumentOptions) {
  const id = documentId;
  const isSharedDocument = options?.isSharedDocument === true;
  const dispatch = useAppDispatch();
  const { currentDocumentId, meta, isLoading, error } = useAppSelector((state) => state.document);
  const { isAuthenticated, accessToken, user, isInitializing, refresh } = useAuth();
  const { isOnline } = useNetworkStatus();
  const initialFallbackAccessLevel =
    readCachedDocumentAccessLevel(id) ?? (isSharedDocument ? 'VIEW' : null);
  const accessTokenRef = useRef<string | null>(accessToken);
  const accessLevelRef = useRef<DocumentAccessLevel | null>(initialFallbackAccessLevel);
  const [resolvedDocumentId, setResolvedDocumentId] = useState(id);
  const [accessLevel, setAccessLevel] = useState<DocumentAccessLevel | null>(
    initialFallbackAccessLevel
  );
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [realtimeProvider, setRealtimeProvider] = useState<WebsocketProvider | null>(null);
  const [errorState, setErrorState] = useState<DocumentErrorState | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const lastLoadContextKeyRef = useRef<string | null>(null);
  const updateMetaSeqRef = useRef(0);
  // Latest committed meta for the Yjs title observer (avoids stale closures
  // without re-subscribing on every keystroke).
  const metaRef = useRef(meta);
  const resolvedDocumentIdRef = useRef(resolvedDocumentId);
  const {
    isInBackoff: isCloudReadInBackoff,
    trigger: triggerCloudReadBackoff,
    clear: clearCloudReadBackoff,
  } = useCloudBackoff();
  const {
    isInBackoff: isCloudMetadataInBackoff,
    trigger: triggerCloudMetadataBackoff,
    clear: clearCloudMetadataBackoff,
  } = useCloudBackoff();

  // Track ydoc in local state so the component re-renders
  // when a new document is loaded (instead of reading from
  // the module-level singleton at render time, which may be stale)
  const [ydoc, setLocalYDoc] = useState<Y.Doc | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const awareness = useMemo(() => (ydoc ? new Awareness(ydoc) : null), [ydoc]);

  // When a document is moved to trash (e.g. from another tab/device), surface the
  // read-only trash view instead of a spurious "access restricted" error. Anyone who
  // held pre-trash access gets the view; only EDIT/OWNER holders may restore.
  const applyTrashedDocumentView = useCallback(
    (
      documentId: string,
      result: DocumentLoadResult,
      trashAccessLevel?: DocumentAccessLevel | null
    ) => {
      ydocRef.current = result.ydoc;
      setLocalYDoc(result.ydoc);
      setYDoc(result.ydoc);
      dispatch(
        setCurrentDocument({
          id: documentId,
          meta: result.meta,
        })
      );
      // Reconcile sidebar/lists with the freshly loaded title (it may have
      // changed elsewhere while this document was not open).
      dispatchDocumentMetaUpdated(documentId, result.meta);
      const nextLevel = trashAccessLevel ?? 'VIEW';
      accessLevelRef.current = nextLevel;
      setAccessLevel(nextLevel);
      // Preserve the pre-trash access level in cache so a refresh shows the
      // correct Restore affordance immediately (Editor.tsx canManageTrash).
      // Reading is still gated by meta.deletedAt, so cached EDIT does not
      // make a trashed doc editable.
      if (trashAccessLevel) {
        writeCachedDocumentAccessLevel(documentId, trashAccessLevel);
      } else {
        clearCachedDocumentAccessLevel(documentId);
      }
      setErrorState(null);
      dispatch(setError(null));
    },
    [dispatch]
  );

  // Shared transition for "you can no longer see this document": drops the in-memory doc,
  // clears any cached access level, and surfaces the restricted-error panel. `source` is
  // either a status code (generic not-found) or the API error that triggered it.
  const enterRestrictedState = useCallback(
    (documentId: string, source: DocumentServiceApiError | number) => {
      clearCachedDocumentAccessLevel(documentId);
      const restrictedError =
        typeof source === 'number'
          ? buildDocumentErrorState(
              new DocumentServiceApiError('The requested resource was not found.', source)
            )
          : buildDocumentErrorState(source);
      setErrorState(restrictedError);
      ydocRef.current = null;
      setLocalYDoc(null);
      setYDoc(null);
      dispatch(clearDocument());
      dispatch(setError(restrictedError.description));
      accessLevelRef.current = null;
      setAccessLevel(null);
    },
    [dispatch]
  );

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    accessLevelRef.current = accessLevel;
  }, [accessLevel]);

  useEffect(() => {
    ydocRef.current = ydoc;
  }, [ydoc]);

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    resolvedDocumentIdRef.current = resolvedDocumentId;
  }, [resolvedDocumentId]);

  useEffect(() => {
    if (!isAuthenticated || isInitializing || errorState === null || ydoc !== null || isLoading) {
      return;
    }

    const retryLoad = () => {
      clearCloudReadBackoff();
      setRetryTrigger((prev) => prev + 1);
    };

    window.addEventListener('cloud-documents-changed', retryLoad);
    window.addEventListener('local-documents-changed', retryLoad);

    return () => {
      window.removeEventListener('cloud-documents-changed', retryLoad);
      window.removeEventListener('local-documents-changed', retryLoad);
    };
  }, [isAuthenticated, isInitializing, errorState, ydoc, isLoading, clearCloudReadBackoff]);

  useEffect(() => {
    if (isInitializing) {
      dispatch(setLoading(true));
      dispatch(setError(null));
      setErrorState(null);
      setLocalYDoc(null);
      ydocRef.current = null;
      setResolvedDocumentId(id);
      lastLoadContextKeyRef.current = null;
      const initialLevel = readCachedDocumentAccessLevel(id) ?? (isSharedDocument ? 'VIEW' : null);
      accessLevelRef.current = initialLevel;
      setAccessLevel(initialLevel);
      return;
    }

    // If access was already revoked (e.g. from websocket close handler), stay in restricted state
    if (errorState?.kind === 'restricted') {
      dispatch(setLoading(false));
      return;
    }

    const loadContextKey = [
      id,
      isAuthenticated ? 'auth' : 'guest',
      user?.id ?? 'anonymous',
      isSharedDocument ? 'shared' : 'private',
    ].join(':');
    const isSameLoadContext = lastLoadContextKeyRef.current === loadContextKey;
    const hasLoadedDocumentForContext = isSameLoadContext && ydocRef.current !== null;

    if (hasLoadedDocumentForContext) {
      return;
    }

    lastLoadContextKeyRef.current = loadContextKey;
    const initialLevel = readCachedDocumentAccessLevel(id) ?? (isSharedDocument ? 'VIEW' : null);
    accessLevelRef.current = initialLevel;
    setAccessLevel(initialLevel);

    let cancelled = false;

    async function loadDoc() {
      try {
        const token = accessTokenRef.current;
        const pendingSyncEditsForRequestedDoc =
          isAuthenticated && token ? readPendingSyncEdits(id) : 0;
        const hasPendingSyncForRequestedDoc = pendingSyncEditsForRequestedDoc > 0;

        dispatch(setLoading(true));
        dispatch(setError(null));
        setErrorState(null);

        let effectiveId = id;
        let result: DocumentLoadResult;
        let guestAccessLevel: DocumentAccessLevel = 'EDIT';
        let loadedFromCloud = false;
        const canAttemptCloudRead = !isCloudReadInBackoff() && !hasPendingSyncForRequestedDoc;

        if (isAuthenticated && token) {
          if (!canAttemptCloudRead) {
            const fallback = await resolveLocalFallbackDocument(id, {
              createIfMissing: false,
            });
            effectiveId = fallback.id;
            result = fallback.result;
          } else {
            try {
              result = await documentService.getCloudDocument(id, token, {
                includeTrashed: true,
              });
              loadedFromCloud = true;
              clearCloudReadBackoff();
            } catch (cloudErr) {
              if (cloudErr instanceof DocumentServiceApiError && cloudErr.status === 401) {
                // Stale token: trigger silent re-auth and fall back to local IDB.
                // The new accessToken from refreshSessionThunk will re-trigger loadDoc.
                void refresh();
              } else if (
                cloudErr instanceof DocumentServiceApiError &&
                (cloudErr.status === 403 || cloudErr.status === 404)
              ) {
                enterRestrictedState(id, cloudErr);
                return;
              } else if (!isConnectivityError(cloudErr)) {
                throw cloudErr;
              } else {
                triggerCloudReadBackoff();
              }

              const fallback = await resolveLocalFallbackDocument(id, {
                createIfMissing: false,
              });
              effectiveId = fallback.id;
              result = fallback.result;
            }
          }
        } else {
          if (isSharedDocument) {
            try {
              result = await documentService.getPublicDocument(id);
              documentService.notePublicLinkDocument(id);
              guestAccessLevel = await resolveGuestAccessLevel(id);
            } catch (publicErr) {
              if (
                publicErr instanceof DocumentServiceApiError &&
                (publicErr.status === 403 || publicErr.status === 404)
              ) {
                enterRestrictedState(effectiveId, publicErr.status);
                return;
              }
              if (!isConnectivityError(publicErr)) {
                throw publicErr;
              }

              const localResult = await documentService.loadDocument(id);
              if (!localResult) {
                throw publicErr;
              }

              result = localResult;
              guestAccessLevel = await resolveGuestAccessLevel(id, 'VIEW');
            }
          } else {
            const localResult = await documentService.loadDocument(id);

            if (localResult && localResult.origin !== 'public-link') {
              result = localResult;
            } else {
              const isKnownPublicLink =
                localResult?.origin === 'public-link' || documentService.isPublicLinkDocument(id);
              try {
                result = await documentService.getPublicDocument(id);
                documentService.notePublicLinkDocument(id);
                guestAccessLevel = await resolveGuestAccessLevel(id);
              } catch (publicErr) {
                if (isConnectivityError(publicErr)) {
                  if (localResult) {
                    result = localResult;
                    guestAccessLevel = await resolveGuestAccessLevel(id, 'VIEW');
                  } else if (isKnownPublicLink) {
                    // The session remembers this id as a share link, but its local
                    // mirror is gone. Recreating a blank EDIT copy offline would let a
                    // guest fabricate writes that later hit the public endpoint, so
                    // deny the opening instead of inventing an editable document.
                    throw new OfflineDocumentUnavailableError(
                      'This shared document has not been opened on this device yet.'
                    );
                  } else {
                    result = await documentService.getOrCreateDocument(id);
                    guestAccessLevel = 'EDIT';
                  }
                } else if (
                  publicErr instanceof DocumentServiceApiError &&
                  publicErr.status === 403
                ) {
                  enterRestrictedState(effectiveId, publicErr.status);
                  return;
                } else if (
                  publicErr instanceof DocumentServiceApiError &&
                  publicErr.status === 404
                ) {
                  if (isKnownPublicLink) {
                    enterRestrictedState(effectiveId, publicErr.status);
                    return;
                  }
                  result = await documentService.getOrCreateDocument(id);
                  guestAccessLevel = 'EDIT';
                } else {
                  throw publicErr;
                }
              }
            }
          }
        }

        const isTrashedDoc = !!result.meta.deletedAt;

        if (isTrashedDoc && !isAuthenticated) {
          enterRestrictedState(effectiveId, 404);
          return;
        }

        if (!cancelled) {
          if (
            isAuthenticated &&
            token &&
            !isCloudReadInBackoff() &&
            !hasPendingSyncForRequestedDoc
          ) {
            try {
              const myAccess = await documentService.getMyAccess(effectiveId, token);
              if (!myAccess.allowed || !myAccess.accessLevel) {
                enterRestrictedState(effectiveId, 404);
                return;
              }
              // Cache the level even for trashed docs so refresh does not
              // flicker to read-only before getMyAccess resolves. The doc
              // stays read-only via meta.deletedAt regardless of cached level.
              writeCachedDocumentAccessLevel(effectiveId, myAccess.accessLevel);
              accessLevelRef.current = myAccess.accessLevel;
              setAccessLevel(myAccess.accessLevel);
            } catch (accessErr) {
              if (
                accessErr instanceof DocumentServiceApiError &&
                (accessErr.status === 403 || accessErr.status === 404)
              ) {
                enterRestrictedState(effectiveId, accessErr);
                return;
              }

              // Access lookup is advisory for UI state; keep the most recently known access level
              // when the network drops so cached shared docs do not become editable offline.
              const fallbackLevel = isTrashedDoc
                ? (readCachedDocumentAccessLevel(effectiveId) ?? accessLevelRef.current ?? 'VIEW')
                : resolveAuthenticatedFallbackAccessLevel(effectiveId, {
                    currentAccessLevel: accessLevelRef.current,
                    isSharedDocument,
                  });
              accessLevelRef.current = fallbackLevel;
              setAccessLevel(fallbackLevel);
            }
          } else {
            const fallbackLevel = isTrashedDoc
              ? (readCachedDocumentAccessLevel(effectiveId) ?? accessLevelRef.current ?? 'VIEW')
              : isAuthenticated
                ? resolveAuthenticatedFallbackAccessLevel(effectiveId, {
                    currentAccessLevel: accessLevelRef.current,
                    isSharedDocument,
                  })
                : guestAccessLevel;
            accessLevelRef.current = fallbackLevel;
            setAccessLevel(fallbackLevel);
            if (!isAuthenticated && !isTrashedDoc) {
              writeCachedDocumentAccessLevel(effectiveId, fallbackLevel);
            }
          }

          if (isAuthenticated && token && loadedFromCloud) {
            try {
              // An account-backed read proves the local copy now belongs to the
              // signed-in user; re-tagging keeps a previous guest mirror from
              // staying filtered out of Private listings after login.
              await documentService.saveDocument(effectiveId, result.ydoc, result.meta, {
                touchUpdatedAt: false,
                origin: 'local',
              });
            } catch (cacheErr) {
              // Cloud read already succeeded; keep editor usable even if local cache write fails.
              console.warn('Failed to cache cloud document locally:', cacheErr);
            }
          }

          ydocRef.current = result.ydoc;
          setResolvedDocumentId(effectiveId);
          setYDoc(result.ydoc);
          setLocalYDoc(result.ydoc);
          dispatch(
            setCurrentDocument({
              id: effectiveId,
              meta: result.meta,
            })
          );
          // The freshly loaded title is authoritative for this open document:
          // fan it out so stale sidebar/list entries (updated elsewhere while
          // this document was closed) reconcile instantly without a refetch.
          dispatchDocumentMetaUpdated(effectiveId, result.meta);
        }
      } catch (err) {
        console.error('Failed to load document:', err);

        if (!cancelled) {
          const nextError = buildDocumentErrorState(err);
          setErrorState(nextError);
          ydocRef.current = null;
          setLocalYDoc(null);
          setYDoc(null);
          dispatch(clearDocument());
          dispatch(setError(nextError.description));
        }
      } finally {
        if (!cancelled) {
          dispatch(setLoading(false));
        }
      }
    }

    // Clear stale ydoc immediately so the editor shows loading state
    setLocalYDoc(null);
    ydocRef.current = null;
    setResolvedDocumentId(id);
    dispatch(clearDocument());
    loadDoc();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    dispatch,
    isAuthenticated,
    accessToken,
    isInitializing,
    isOnline,
    isSharedDocument,
    user?.id,
    isCloudReadInBackoff,
    clearCloudReadBackoff,
    triggerCloudReadBackoff,
    refresh,
    retryTrigger,
  ]);

  // Guests connect once any level is known; later changes arrive as socket
  // messages. Depending on the raw level would tear the provider down and
  // rebuild it on every access revalidation.
  const isGuestRealtimeLevelKnown = accessLevel !== null;

  useEffect(() => {
    const realtimeUrl = getRealtimeUrl();
    // Guests connect anonymously: the realtime server evaluates access-check
    // without credentials against share-link grants. An empty token param is
    // sent so the server treats the connection as anonymous.
    const canConnectRealtime = isAuthenticated
      ? Boolean(accessTokenRef.current)
      : isGuestRealtimeLevelKnown;
    if (
      !realtimeUrl ||
      !ydoc ||
      !resolvedDocumentId ||
      !isRealtimeEligibleDocumentId(resolvedDocumentId) ||
      !isOnline ||
      isLoading ||
      errorState !== null ||
      // Trashed documents are served as a read-only, REST-only view (restore/trash UI).
      // The realtime server strictly rejects access checks for trashed documents, so
      // connecting would trigger a 1008 close followed by a spurious "access restricted"
      // error for the document owner.
      !!meta?.deletedAt ||
      isCloudReadInBackoff() ||
      !canConnectRealtime
    ) {
      setIsRealtimeConnected(false);
      setRealtimeProvider(null);
      return;
    }

    const wsParams = {
      get token(): string {
        return accessTokenRef.current ?? '';
      },
    };

    const provider = new WebsocketProvider(realtimeUrl, resolvedDocumentId, ydoc, {
      params: wsParams,
      awareness: awareness ?? undefined,
    });

    const statusHandler = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      setIsRealtimeConnected(event.status === 'connected');
    };
    let closeHandlerCancelled = false;

    const connectionCloseHandler = (event: CloseEvent | null) => {
      if (!event || event.code !== 1008) {
        return;
      }

      // We perform a one-off /my-access fetch to distinguish between a stale token/expired session (401)
      // and a true access revocation (403/404). This prevents locking the user out unnecessarily
      // when their session simply needs to be refreshed.
      // Prevent reconnection race: stop reconnection before the async verification
      provider.shouldConnect = false;

      const verifyAccessAndHandleClose = async () => {
        try {
          const token = accessTokenRef.current;
          if (token) {
            const myAccess = await documentService.getMyAccess(resolvedDocumentId, token);
            if (closeHandlerCancelled) return;
            if (myAccess.trashed && myAccess.allowed && myAccess.accessLevel) {
              // The realtime server strictly rejects access checks for trashed documents,
              // so a 1008 close here means the document moved to trash (from another
              // tab/device), not that access was revoked. Anyone who held pre-trash access
              // gets the read-only trash view.
              try {
                const cloudCopy = await documentService.getCloudDocument(
                  resolvedDocumentId,
                  token,
                  { includeTrashed: true }
                );
                if (closeHandlerCancelled) return;
                if (cloudCopy.meta.deletedAt) {
                  applyTrashedDocumentView(resolvedDocumentId, cloudCopy, myAccess.accessLevel);
                  provider.shouldConnect = false;
                  setIsRealtimeConnected(false);
                  setRealtimeProvider((current) => (current === provider ? null : current));
                  return;
                }
                // The document was restored between getMyAccess and getCloudDocument:
                // keep the document active and allow reconnection.
                writeCachedDocumentAccessLevel(resolvedDocumentId, myAccess.accessLevel);
                setAccessLevel(myAccess.accessLevel);
                provider.shouldConnect = true;
                return;
              } catch (cloudErr) {
                if (closeHandlerCancelled) return;
                if (
                  cloudErr instanceof DocumentServiceApiError &&
                  (cloudErr.status === 403 || cloudErr.status === 404)
                ) {
                  // Trash view unavailable (e.g. purged in the meantime) - treat as revoked.
                  handleAccessRevoked(cloudErr.status);
                  return;
                }
                console.warn('Failed to fetch trashed document status on close:', cloudErr);
                return;
              }
            }
            if (!myAccess.allowed || !myAccess.accessLevel) {
              // Access has been officially revoked/restricted.
              handleAccessRevoked(404);
              return;
            }
            // Access is still valid - allow reconnection
            provider.shouldConnect = true;
          } else if (!isAuthenticated) {
            // Anonymous guest: re-check the share link. A revoked link (or a
            // link downgraded below the needed level) surfaces as restricted;
            // otherwise keep reconnecting.
            try {
              const publicAccess = await documentService.checkAccess(resolvedDocumentId);
              if (closeHandlerCancelled) return;
              if (!publicAccess.allowed || !publicAccess.accessLevel) {
                handleAccessRevoked(404);
                return;
              }
              writeCachedDocumentAccessLevel(resolvedDocumentId, publicAccess.accessLevel);
              setAccessLevel(publicAccess.accessLevel);
              provider.shouldConnect = true;
            } catch (publicErr) {
              if (closeHandlerCancelled) return;
              if (
                publicErr instanceof DocumentServiceApiError &&
                (publicErr.status === 403 || publicErr.status === 404)
              ) {
                handleAccessRevoked(publicErr.status);
                return;
              }
              // Transient failure (e.g. 429 rate limit or offline): keep reconnecting
              provider.shouldConnect = true;
              return;
            }
          } else {
            handleAccessRevoked(401);
            return;
          }
        } catch (err) {
          if (err instanceof DocumentServiceApiError && err.status === 401) {
            if (closeHandlerCancelled) return;
            // Token is stale, trigger silent session refresh.
            // Reconnection will automatically use the new token on the next retry.
            void refresh();
            return;
          }
          if (
            err instanceof DocumentServiceApiError &&
            (err.status === 403 || err.status === 404)
          ) {
            if (closeHandlerCancelled) return;
            // Access has been officially revoked/restricted.
            handleAccessRevoked(err.status);
            return;
          }
        }

        // For transient errors or if access is still valid, we let the provider continue reconnecting
      };

      const handleAccessRevoked = (statusCode: number = 404) => {
        if (closeHandlerCancelled) return;
        enterRestrictedState(resolvedDocumentId, statusCode);

        provider.shouldConnect = false;
        setIsRealtimeConnected(false);
        setRealtimeProvider((current) => (current === provider ? null : current));
      };

      void verifyAccessAndHandleClose();
    };

    provider.on('status', statusHandler);
    provider.on('connection-close', connectionCloseHandler);
    setRealtimeProvider(provider);

    // NOTE: presence `user` field is written solely by EditorContent to avoid
    // last-render-wins nondeterminism from two writers to the same awareness.

    return () => {
      closeHandlerCancelled = true;
      provider.off('status', statusHandler);
      provider.off('connection-close', connectionCloseHandler);
      provider.shouldConnect = false;
      provider.destroy();
      setIsRealtimeConnected(false);
      setRealtimeProvider(null);
    };
  }, [
    ydoc,
    awareness,
    resolvedDocumentId,
    isOnline,
    isLoading,
    errorState,
    isAuthenticated,
    isGuestRealtimeLevelKnown,
    meta?.deletedAt,
    isCloudReadInBackoff,
    refresh,
    dispatch,
    applyTrashedDocumentView,
    enterRestrictedState,
  ]);

  // Awareness starts an interval on construction and destroys itself on ydoc
  // destroy. Explicitly destroy on ydoc swap/unmount to avoid leaking the
  // interval when the holder retains the doc. Declared after the provider
  // effect so provider teardown (unsubscribe) runs before awareness destroy.
  useEffect(() => {
    return () => {
      awareness?.destroy();
    };
  }, [awareness]);

  // Listen for server-pushed access-level changes and apply them immediately.
  useEffect(() => {
    if (!realtimeProvider || !isRealtimeConnected) {
      return;
    }

    // y-websocket stores the raw websocket on an internal field, which differs
    // between versions. Support both names to avoid missing permission updates.
    const wsConn =
      (
        realtimeProvider as WebsocketProvider & {
          _conn?: WebSocket;
          ws?: WebSocket;
        }
      )._conn ?? (realtimeProvider as WebsocketProvider & { ws?: WebSocket }).ws;

    if (!wsConn) {
      return;
    }

    const applyAccessLevelIfPresent = (payload: ArrayBuffer) => {
      if (payload.byteLength < 1) {
        return;
      }

      const messageType = new DataView(payload).getUint8(0);
      if (messageType !== MESSAGE_ACCESS_LEVEL) {
        return;
      }

      try {
        const decodedAccessLevel = decodeStringFromBuffer(payload, 1);

        if (!isValidDocumentAccessLevel(decodedAccessLevel)) {
          console.warn(
            'Ignoring invalid access level message from realtime payload:',
            decodedAccessLevel
          );
          return;
        }

        setAccessLevel(decodedAccessLevel);
        writeCachedDocumentAccessLevel(resolvedDocumentId, decodedAccessLevel);
      } catch (err) {
        console.warn('Failed to decode access level message:', err);
      }
    };

    const messageHandler = (event: MessageEvent) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          applyAccessLevelIfPresent(event.data);
          return;
        }

        if (event.data instanceof Blob) {
          void event.data
            .arrayBuffer()
            .then(applyAccessLevelIfPresent)
            .catch((err) => {
              console.warn('Failed to read websocket blob message:', err);
            });
        }
      } catch (err) {
        console.warn('Error while handling websocket access-level message:', err);
      }
    };

    wsConn.addEventListener('message', messageHandler);

    return () => {
      wsConn.removeEventListener('message', messageHandler);
    };
  }, [realtimeProvider, isRealtimeConnected, resolvedDocumentId]);

  // Periodically revalidate access level to detect downgrades immediately
  useEffect(() => {
    const canPollAsGuest = !isAuthenticated && accessLevelRef.current !== null;
    if (
      (!isAuthenticated && !canPollAsGuest) ||
      (isAuthenticated && !accessToken) ||
      !isOnline ||
      isCloudReadInBackoff() ||
      !resolvedDocumentId ||
      resolvedDocumentId !== currentDocumentId ||
      !!meta?.deletedAt ||
      isRealtimeConnected // Skip polling if we have an active realtime WebSocket connection
    ) {
      return;
    }

    const checkAccessLevel = async () => {
      // Background tabs share the IP rate-limit budget with the visible tab;
      // skip polling while hidden (fresh check runs on visibilitychange below).
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      if (isCloudReadInBackoff()) {
        return;
      }
      if (!isAuthenticated) {
        try {
          const publicAccess = await documentService.checkAccess(resolvedDocumentId);
          if (!publicAccess.allowed || !publicAccess.accessLevel) {
            enterRestrictedState(resolvedDocumentId, 404);
            return;
          }
          if (publicAccess.accessLevel !== accessLevelRef.current) {
            writeCachedDocumentAccessLevel(resolvedDocumentId, publicAccess.accessLevel);
            setAccessLevel(publicAccess.accessLevel);
          }
        } catch (err) {
          if (
            err instanceof DocumentServiceApiError &&
            (err.status === 403 || err.status === 404)
          ) {
            enterRestrictedState(resolvedDocumentId, err);
            return;
          }
          if (isConnectivityError(err)) {
            triggerCloudReadBackoff(backoffMsFor(err));
          }
        }
        return;
      }
      const token = accessToken;
      if (!token) {
        return;
      }
      try {
        const myAccess = await documentService.getMyAccess(resolvedDocumentId, token);
        if (myAccess.trashed && myAccess.allowed && myAccess.accessLevel) {
          // The document moved to trash between polls - swap to the read-only trash view
          // for anyone who held pre-trash access.
          try {
            const cloudCopy = await documentService.getCloudDocument(resolvedDocumentId, token, {
              includeTrashed: true,
            });
            if (cloudCopy.meta.deletedAt) {
              applyTrashedDocumentView(resolvedDocumentId, cloudCopy, myAccess.accessLevel);
              return;
            }
            // The document was restored between getMyAccess and getCloudDocument:
            writeCachedDocumentAccessLevel(resolvedDocumentId, myAccess.accessLevel);
            setAccessLevel(myAccess.accessLevel);
            return;
          } catch (cloudErr) {
            if (
              cloudErr instanceof DocumentServiceApiError &&
              (cloudErr.status === 403 || cloudErr.status === 404)
            ) {
              enterRestrictedState(resolvedDocumentId, cloudErr);
              return;
            }
            console.warn('Failed to fetch trashed document status:', cloudErr);
            return;
          }
        }
        if (!myAccess.allowed || !myAccess.accessLevel) {
          enterRestrictedState(resolvedDocumentId, 404);
          return;
        }
        if (myAccess.accessLevel !== accessLevelRef.current) {
          writeCachedDocumentAccessLevel(resolvedDocumentId, myAccess.accessLevel);
          setAccessLevel(myAccess.accessLevel);
        }
      } catch (err) {
        if (err instanceof DocumentServiceApiError && err.status === 401) {
          // Stale token: silently attempt re-auth. When refreshSessionThunk resolves
          // with a new accessToken, the dep change tears down and recreates this
          // effect (and its interval) automatically — no manual retry needed.
          void refresh();
          return;
        }

        if (err instanceof DocumentServiceApiError && (err.status === 403 || err.status === 404)) {
          enterRestrictedState(resolvedDocumentId, err);
          return;
        }

        if (isConnectivityError(err)) {
          triggerCloudReadBackoff(backoffMsFor(err));
        }

        console.warn('Failed to revalidate access level:', err);
      }
    };

    // Check immediately on mount, then every 15 seconds as a fallback
    // in case websocket access-level pushes are delayed.
    checkAccessLevel();
    const interval = setInterval(checkAccessLevel, 15000);
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void checkAccessLevel();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [
    isAuthenticated,
    accessToken,
    isOnline,
    resolvedDocumentId,
    currentDocumentId,
    meta,
    dispatch,
    isCloudReadInBackoff,
    refresh,
    isRealtimeConnected,
    applyTrashedDocumentView,
    enterRestrictedState,
    triggerCloudReadBackoff,
  ]);

  const updateMeta = useCallback(
    (updates: Partial<DocumentMeta>) => {
      if (!meta) {
        console.warn('Cannot update meta: meta is null');
        return;
      }

      if (isReadOnlyAccessLevel(accessLevelRef.current)) {
        console.warn('Cannot update meta: document is read-only');
        return;
      }

      // Never persist a blank title: blank titles fall back to Untitled on
      // the API, and a failed write's rollback would resurrect the last
      // non-blank value (e.g. a stuck "t" after clearing "th"). The title
      // input renders 'Untitled' as empty, so normalizing here keeps the UI
      // empty with no flicker.
      const normalizedUpdates =
        updates.title !== undefined
          ? { ...updates, title: normalizeDocumentTitle(updates.title) }
          : updates;

      const seq = updateMetaSeqRef.current + 1;
      updateMetaSeqRef.current = seq;

      const previousMeta = { ...meta };
      const updatedAt = new Date().toISOString();
      const updatedMeta = { ...meta, ...normalizedUpdates, updatedAt };

      dispatch(updateMetaAction({ ...normalizedUpdates, updatedAt }));

      dispatchDocumentMetaUpdated(resolvedDocumentId, updatedMeta);

      // Mirror title into the shared Yjs map for instant cross-client sync.
      // The map observer below ignores this echo (titles already equal), and
      // remote applies never write back, so no loop is possible. REST PATCH
      // below remains the durable persist for lists/trees.
      if (normalizedUpdates.title !== undefined && ydocRef.current) {
        try {
          const metaMap = ydocRef.current.getMap<string>(YJS_META_MAP_KEY);
          if (metaMap.get(YJS_META_TITLE_KEY) !== normalizedUpdates.title) {
            metaMap.set(YJS_META_TITLE_KEY, normalizedUpdates.title);
          }
        } catch (err) {
          console.warn('Failed to mirror title into Yjs:', err);
        }
      }

      const persistLocalMetadata = async () => {
        await documentService.updateMetadata(resolvedDocumentId, normalizedUpdates);
        documentService.emitLocalDocumentsChanged();
      };

      const canAttemptCloudMetadataWrite =
        isAuthenticated && accessToken && isOnline && !isCloudMetadataInBackoff();
      const canAttemptPublicMetadataWrite =
        !isAuthenticated &&
        (isSharedDocument || documentService.isPublicLinkDocument(resolvedDocumentId)) &&
        (accessLevelRef.current === 'EDIT' || accessLevelRef.current === 'OWNER') &&
        isOnline &&
        !isCloudMetadataInBackoff();
      const isRemoteMetadataWrite = canAttemptCloudMetadataWrite || canAttemptPublicMetadataWrite;

      const queuePendingSync = () => {
        if (isAuthenticated && accessToken) {
          incrementPendingSyncEdits(resolvedDocumentId);
        }
      };

      const rollback = () => {
        dispatch(updateMetaAction({ ...previousMeta, updatedAt: previousMeta.updatedAt }));
      };

      // Only roll back if no newer updateMeta has dispatched since. Without
      // this, a slow failure from an older keystroke can clobber a newer
      // successfully-persisted title.
      const guardedRollback = () => {
        if (updateMetaSeqRef.current !== seq) {
          return;
        }
        rollback();
      };

      const persistPromise = canAttemptCloudMetadataWrite
        ? documentService
            .updateCloudMetadata(resolvedDocumentId, normalizedUpdates, accessToken)
            .then(async () => {
              try {
                await documentService.updateMetadata(resolvedDocumentId, {
                  ...normalizedUpdates,
                  updatedAt: updatedMeta.updatedAt,
                });
              } catch (cacheErr) {
                console.warn('Failed to mirror cloud metadata into local cache:', cacheErr);
              }
            })
        : canAttemptPublicMetadataWrite
          ? documentService
              .updatePublicMetadata(resolvedDocumentId, normalizedUpdates)
              .then(async () => {
                try {
                  await documentService.updateMetadata(resolvedDocumentId, {
                    ...normalizedUpdates,
                    updatedAt: updatedMeta.updatedAt,
                  });
                } catch (cacheErr) {
                  console.warn('Failed to mirror public metadata into local cache:', cacheErr);
                }
              })
          : persistLocalMetadata().then(() => {
              queuePendingSync();
            });

      persistPromise
        .then(() => {
          if (isRemoteMetadataWrite) {
            clearCloudMetadataBackoff();
          }
        })
        .catch(async (err) => {
          if (isRemoteMetadataWrite && isConnectivityError(err)) {
            triggerCloudMetadataBackoff();

            try {
              await persistLocalMetadata();
              queuePendingSync();
              return;
            } catch (localErr) {
              console.error('Failed to persist metadata update:', localErr);
              guardedRollback();
              return;
            }
          }

          console.error('Failed to persist metadata update:', err);
          guardedRollback();
        });
    },
    [
      meta,
      dispatch,
      isAuthenticated,
      accessToken,
      isOnline,
      resolvedDocumentId,
      isCloudMetadataInBackoff,
      clearCloudMetadataBackoff,
      triggerCloudMetadataBackoff,
      isSharedDocument,
    ]
  );

  // Live title sync across collaborators via the shared Yjs `meta` map.
  // Local edits write the map in updateMeta above; remote Yjs updates land
  // here through the map observer and are applied to Redux + the
  // document-meta-updated fan-out (sidebar trees, document lists,
  // breadcrumbs) without re-writing Yjs or re-PATCHing REST.
  // Seed the map for documents created before Yjs title sync existed, so
  // late joiners receive the current title over the live channel. Runs on
  // meta.title (not just ydoc) so a late REST load still seeds, and skips
  // read-only clients so COMMENT/VIEW never emit updates the server drops.
  useEffect(() => {
    if (!ydoc || !resolvedDocumentId) {
      return;
    }
    if (isReadOnlyAccessLevel(accessLevel)) {
      return;
    }
    const seedTitle = meta?.title;
    if (seedTitle === undefined) {
      return;
    }
    try {
      const metaMap = ydoc.getMap<string>(YJS_META_MAP_KEY);
      if (metaMap.get(YJS_META_TITLE_KEY) === undefined) {
        metaMap.set(YJS_META_TITLE_KEY, normalizeDocumentTitle(seedTitle));
      }
    } catch (err) {
      console.warn('Failed to seed Yjs title:', err);
    }
  }, [ydoc, resolvedDocumentId, meta?.title, accessLevel]);

  useEffect(() => {
    if (!ydoc || !resolvedDocumentId) {
      return;
    }

    const metaMap = ydoc.getMap<string>(YJS_META_MAP_KEY);

    const observer = () => {
      const yjsTitle = metaMap.get(YJS_META_TITLE_KEY);
      if (typeof yjsTitle !== 'string') {
        return;
      }
      // Hand-crafted EDIT writes can carry blank titles; honor the same
      // Untitled invariant as local edits and the API.
      const normalizedTitle = normalizeDocumentTitle(yjsTitle);
      const localTitle = metaRef.current?.title;
      // Local echo (our own updateMeta wrote the map after committing Redux)
      // or duplicate delivery: already applied, nothing to do.
      if (normalizedTitle === localTitle) {
        return;
      }
      if (!metaRef.current) {
        return;
      }
      const updatedAt = new Date().toISOString();
      const nextMeta = { ...metaRef.current, title: normalizedTitle, updatedAt };
      dispatch(updateMetaAction({ title: normalizedTitle, updatedAt }));
      dispatchDocumentMetaUpdated(resolvedDocumentIdRef.current, nextMeta);
    };

    metaMap.observe(observer);
    return () => {
      metaMap.unobserve(observer);
    };
  }, [ydoc, resolvedDocumentId, dispatch]);

  // Listen for external restore events (e.g. from the sidebar)
  useEffect(() => {
    if (!resolvedDocumentId || !meta?.deletedAt) {
      return;
    }

    const handleDocsChanged = async () => {
      try {
        const localCopy = await documentService.loadDocument(resolvedDocumentId);
        if (localCopy && !localCopy.meta.deletedAt) {
          const updatedAt = new Date().toISOString();
          dispatch(
            updateMetaAction({
              deletedAt: undefined,
              purgeAt: undefined,
              updatedAt,
            })
          );
          let nextLevel: DocumentAccessLevel = accessLevelRef.current ?? 'OWNER';
          const token = accessTokenRef.current;
          if (token) {
            try {
              const myAccess = await documentService.getMyAccess(resolvedDocumentId, token);
              if (myAccess.allowed && myAccess.accessLevel) {
                nextLevel = myAccess.accessLevel;
              }
            } catch {
              // fallback
            }
          }
          setAccessLevel(nextLevel);
          writeCachedDocumentAccessLevel(resolvedDocumentId, nextLevel);
        }
      } catch (err) {
        console.warn('Failed to check document status on docs changed:', err);
      }
    };

    window.addEventListener('cloud-documents-changed', handleDocsChanged);
    window.addEventListener('local-documents-changed', handleDocsChanged);

    return () => {
      window.removeEventListener('cloud-documents-changed', handleDocsChanged);
      window.removeEventListener('local-documents-changed', handleDocsChanged);
    };
  }, [resolvedDocumentId, meta?.deletedAt, dispatch]);

  const restore = useCallback(async () => {
    if (!isAuthenticated || !accessToken || !resolvedDocumentId) {
      return;
    }
    await documentService.restoreCloudDocumentFromTrash(resolvedDocumentId, accessToken);

    const updatedAt = new Date().toISOString();
    dispatch(
      updateMetaAction({
        deletedAt: undefined,
        purgeAt: undefined,
        updatedAt,
      })
    );

    let nextLevel: DocumentAccessLevel = accessLevelRef.current ?? 'OWNER';
    try {
      const myAccess = await documentService.getMyAccess(resolvedDocumentId, accessToken);
      if (myAccess.allowed && myAccess.accessLevel) {
        nextLevel = myAccess.accessLevel;
      }
    } catch {
      // fallback
    }

    accessLevelRef.current = nextLevel;
    setAccessLevel(nextLevel);
    writeCachedDocumentAccessLevel(resolvedDocumentId, nextLevel);
  }, [isAuthenticated, accessToken, resolvedDocumentId, dispatch]);

  return {
    documentId: resolvedDocumentId,
    ydoc,
    awareness,
    meta,
    accessLevel,
    isReadOnly:
      isReadOnlyAccessLevel(accessLevel) ||
      (isSharedDocument && accessLevel === null) ||
      !!meta?.deletedAt,
    isRealtimeConnected,
    realtimeProvider,
    errorState,
    isLoading,
    error: error ? new Error(error) : null,
    updateMeta,
    restore,
  };
}
