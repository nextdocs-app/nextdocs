import { useEffect, useCallback, useRef, useState } from 'react';
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
import { isConnectivityError } from '@/lib/cloud-connectivity.util';
import {
  clearCachedDocumentAccessLevel,
  readCachedDocumentAccessLevel,
  writeCachedDocumentAccessLevel,
} from '@/lib/document-access.util';
import { getPresenceColor, isReadOnlyAccessLevel } from '@/lib/realtime.util';
import { incrementPendingSyncEdits, readPendingSyncEdits } from '@/lib/offline-sync.util';
import { isRealtimeEligibleDocumentId } from '@/lib/document-id.util';
import type { DocumentLoadResult, DocumentMeta } from '@/types/document.types';
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:1234';
const MESSAGE_ACCESS_LEVEL = 2;
const VALID_DOCUMENT_ACCESS_LEVELS: readonly DocumentAccessLevel[] = [
  'VIEW',
  'COMMENT',
  'EDIT',
  'OWNER',
];

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
  const { meta, isLoading, error } = useAppSelector((state) => state.document);
  const { isAuthenticated, accessToken, user, isInitializing, refresh } = useAuth();
  const { isOnline } = useNetworkStatus();
  const accessTokenRef = useRef<string | null>(accessToken);
  const accessLevelRef = useRef<DocumentAccessLevel | null>('EDIT');
  const [resolvedDocumentId, setResolvedDocumentId] = useState(id);
  const [accessLevel, setAccessLevel] = useState<DocumentAccessLevel | null>('EDIT');
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [realtimeProvider, setRealtimeProvider] = useState<WebsocketProvider | null>(null);
  const [errorState, setErrorState] = useState<DocumentErrorState | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const lastLoadContextKeyRef = useRef<string | null>(null);
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

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    accessLevelRef.current = accessLevel;
  }, [accessLevel]);

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
      setResolvedDocumentId(id);
      lastLoadContextKeyRef.current = null;
      return;
    }

    const loadContextKey = [
      id,
      isAuthenticated ? 'auth' : 'guest',
      user?.id ?? 'anonymous',
      isSharedDocument ? 'shared' : 'private',
    ].join(':');
    const isSameLoadContext = lastLoadContextKeyRef.current === loadContextKey;
    const hasLoadedDocumentForContext = isSameLoadContext && ydoc !== null;

    if (hasLoadedDocumentForContext) {
      return;
    }

    lastLoadContextKeyRef.current = loadContextKey;

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
              result = await documentService.getCloudDocument(id, token);
              loadedFromCloud = true;

              clearCloudReadBackoff();
            } catch (cloudErr) {
              if (cloudErr instanceof DocumentServiceApiError && cloudErr.status === 401) {
                // Stale token: trigger silent re-auth and fall back to local IDB.
                // The new accessToken from refreshSessionThunk will re-trigger loadDoc.
                void refresh();
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
              guestAccessLevel = 'VIEW';
            } catch (publicErr) {
              if (!isConnectivityError(publicErr)) {
                throw publicErr;
              }

              const localResult = await documentService.loadDocument(id);
              if (!localResult) {
                throw publicErr;
              }

              result = localResult;
              guestAccessLevel = 'VIEW';
            }
          } else {
            const localResult = await documentService.loadDocument(id);

            if (localResult) {
              result = localResult;
            } else {
              try {
                result = await documentService.getPublicDocument(id);
                guestAccessLevel = 'VIEW';
              } catch (publicErr) {
                if (isConnectivityError(publicErr)) {
                  result = await documentService.getOrCreateDocument(id);
                  guestAccessLevel = 'EDIT';
                } else if (
                  !(publicErr instanceof DocumentServiceApiError) ||
                  (publicErr.status !== 403 && publicErr.status !== 404)
                ) {
                  throw publicErr;
                } else {
                  result = await documentService.getOrCreateDocument(id);
                }
              }
            }
          }
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
                clearCachedDocumentAccessLevel(effectiveId);
                const restrictedError = buildDocumentErrorState(
                  new DocumentServiceApiError('The requested resource was not found.', 404)
                );
                setErrorState(restrictedError);
                setLocalYDoc(null);
                setYDoc(null);
                dispatch(clearDocument());
                dispatch(setError(restrictedError.description));
                setAccessLevel(null);
                return;
              }
              writeCachedDocumentAccessLevel(effectiveId, myAccess.accessLevel);
              setAccessLevel(myAccess.accessLevel);
            } catch (accessErr) {
              if (
                accessErr instanceof DocumentServiceApiError &&
                (accessErr.status === 403 || accessErr.status === 404)
              ) {
                clearCachedDocumentAccessLevel(effectiveId);
                const restrictedError = buildDocumentErrorState(accessErr);
                setErrorState(restrictedError);
                setLocalYDoc(null);
                setYDoc(null);
                dispatch(clearDocument());
                dispatch(setError(restrictedError.description));
                setAccessLevel(null);
                return;
              }

              // Access lookup is advisory for UI state; keep the most recently known access level
              // when the network drops so cached shared docs do not become editable offline.
              console.warn(
                'Unable to fetch document access level, using cached/default access level:',
                accessErr
              );
              setAccessLevel(
                resolveAuthenticatedFallbackAccessLevel(effectiveId, {
                  currentAccessLevel: accessLevelRef.current,
                  isSharedDocument,
                })
              );
            }
          } else {
            setAccessLevel(
              isAuthenticated
                ? resolveAuthenticatedFallbackAccessLevel(effectiveId, {
                    currentAccessLevel: accessLevelRef.current,
                    isSharedDocument,
                  })
                : guestAccessLevel
            );
          }

          if (isAuthenticated && token && loadedFromCloud) {
            try {
              await documentService.saveDocument(effectiveId, result.ydoc, result.meta, {
                touchUpdatedAt: false,
              });
            } catch (cacheErr) {
              // Cloud read already succeeded; keep editor usable even if local cache write fails.
              console.warn('Failed to cache cloud document locally:', cacheErr);
            }
          }

          setResolvedDocumentId(effectiveId);
          setYDoc(result.ydoc);
          setLocalYDoc(result.ydoc);
          dispatch(
            setCurrentDocument({
              id: effectiveId,
              meta: result.meta,
            })
          );
        }
      } catch (err) {
        console.error('Failed to load document:', err);

        if (!cancelled) {
          const nextError = buildDocumentErrorState(err);
          setErrorState(nextError);
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
    setResolvedDocumentId(id);
    loadDoc();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    dispatch,
    isAuthenticated,
    accessToken,
    isInitializing,
    ydoc,
    isOnline,
    isSharedDocument,
    user?.id,
    isCloudReadInBackoff,
    clearCloudReadBackoff,
    triggerCloudReadBackoff,
    refresh,
    retryTrigger,
  ]);

  useEffect(() => {
    if (
      !REALTIME_URL ||
      !ydoc ||
      !resolvedDocumentId ||
      !isRealtimeEligibleDocumentId(resolvedDocumentId) ||
      !isOnline ||
      isLoading ||
      errorState !== null ||
      isCloudReadInBackoff() ||
      !isAuthenticated ||
      !accessTokenRef.current
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

    const provider = new WebsocketProvider(REALTIME_URL, resolvedDocumentId, ydoc, {
      params: wsParams,
    });

    const statusHandler = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      setIsRealtimeConnected(event.status === 'connected');
    };
    const connectionCloseHandler = (event: CloseEvent | null) => {
      if (!event || event.code !== 1008) {
        return;
      }

      provider.shouldConnect = false;
      setIsRealtimeConnected(false);
      setRealtimeProvider((current) => (current === provider ? null : current));
    };

    provider.on('status', statusHandler);
    provider.on('connection-close', connectionCloseHandler);
    setRealtimeProvider(provider);

    const userName = user?.displayName || user?.email || meta?.createdBy || 'NextDocs User';
    const colorSeed = user?.id || user?.email || `${resolvedDocumentId}:${userName}`;
    provider.awareness.setLocalStateField('user', {
      name: userName,
      color: getPresenceColor(colorSeed),
    });

    return () => {
      provider.off('status', statusHandler);
      provider.off('connection-close', connectionCloseHandler);
      provider.shouldConnect = false;
      provider.destroy();
      setIsRealtimeConnected(false);
      setRealtimeProvider(null);
    };
  }, [
    ydoc,
    resolvedDocumentId,
    isOnline,
    isLoading,
    errorState,
    isAuthenticated,
    meta?.createdBy,
    user?.id,
    user?.email,
    user?.displayName,
    isCloudReadInBackoff,
  ]);

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
    if (
      !isAuthenticated ||
      !accessToken ||
      !isOnline ||
      isCloudReadInBackoff() ||
      !resolvedDocumentId
    ) {
      return;
    }

    const checkAccessLevel = async () => {
      try {
        const myAccess = await documentService.getMyAccess(resolvedDocumentId, accessToken);
        if (!myAccess.allowed || !myAccess.accessLevel) {
          clearCachedDocumentAccessLevel(resolvedDocumentId);
          const restrictedError = buildDocumentErrorState(
            new DocumentServiceApiError('The requested resource was not found.', 404)
          );
          setErrorState(restrictedError);
          setLocalYDoc(null);
          setYDoc(null);
          dispatch(clearDocument());
          dispatch(setError(restrictedError.description));
          setAccessLevel(null);
          return;
        }
        writeCachedDocumentAccessLevel(resolvedDocumentId, myAccess.accessLevel);
        setAccessLevel(myAccess.accessLevel);
      } catch (err) {
        if (err instanceof DocumentServiceApiError && err.status === 401) {
          // Stale token: silently attempt re-auth. When refreshSessionThunk resolves
          // with a new accessToken, the dep change tears down and recreates this
          // effect (and its interval) automatically — no manual retry needed.
          void refresh();
          return;
        }

        if (err instanceof DocumentServiceApiError && (err.status === 403 || err.status === 404)) {
          clearCachedDocumentAccessLevel(resolvedDocumentId);
          const restrictedError = buildDocumentErrorState(err);
          setErrorState(restrictedError);
          setLocalYDoc(null);
          setYDoc(null);
          dispatch(clearDocument());
          dispatch(setError(restrictedError.description));
          setAccessLevel(null);
          return;
        }

        console.warn('Failed to revalidate access level:', err);
      }
    };

    // Check immediately on mount, then every 5 seconds as a fallback
    // in case websocket access-level pushes are delayed.
    checkAccessLevel();
    const interval = setInterval(checkAccessLevel, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [
    isAuthenticated,
    accessToken,
    isOnline,
    resolvedDocumentId,
    dispatch,
    isCloudReadInBackoff,
    refresh,
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

      const previousMeta = { ...meta };
      const updatedAt = new Date().toISOString();
      const updatedMeta = { ...meta, ...updates, updatedAt };

      dispatch(updateMetaAction({ ...updates, updatedAt }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('document-meta-updated', {
            detail: { id: resolvedDocumentId, meta: updatedMeta },
          })
        );
      }

      const persistLocalMetadata = async () => {
        await documentService.updateMetadata(resolvedDocumentId, updates);
        documentService.emitLocalDocumentsChanged();
      };

      const canAttemptCloudMetadataWrite =
        isAuthenticated && accessToken && isOnline && !isCloudMetadataInBackoff();

      const queuePendingSync = () => {
        if (isAuthenticated && accessToken) {
          incrementPendingSyncEdits(resolvedDocumentId);
        }
      };

      const rollback = () => {
        dispatch(updateMetaAction({ ...previousMeta, updatedAt: previousMeta.updatedAt }));
      };

      const persistPromise = canAttemptCloudMetadataWrite
        ? documentService
            .updateCloudMetadata(resolvedDocumentId, updates, accessToken)
            .then(async () => {
              try {
                await documentService.updateMetadata(resolvedDocumentId, {
                  ...updates,
                  updatedAt: updatedMeta.updatedAt,
                });
              } catch (cacheErr) {
                console.warn('Failed to mirror cloud metadata into local cache:', cacheErr);
              }
            })
        : persistLocalMetadata().then(() => {
            queuePendingSync();
          });

      persistPromise
        .then(() => {
          if (canAttemptCloudMetadataWrite) {
            clearCloudMetadataBackoff();
          }
        })
        .catch(async (err) => {
          if (canAttemptCloudMetadataWrite && isConnectivityError(err)) {
            triggerCloudMetadataBackoff();

            try {
              await persistLocalMetadata();
              queuePendingSync();
              return;
            } catch (localErr) {
              console.error('Failed to persist metadata update:', localErr);
              rollback();
              return;
            }
          }

          console.error('Failed to persist metadata update:', err);
          rollback();
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
    ]
  );

  return {
    documentId: resolvedDocumentId,
    ydoc,
    meta,
    accessLevel,
    isReadOnly: isReadOnlyAccessLevel(accessLevel),
    isRealtimeConnected,
    realtimeProvider,
    errorState,
    isLoading,
    error: error ? new Error(error) : null,
    updateMeta,
  };
}
