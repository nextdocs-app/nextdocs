import { useEffect, useCallback, useState } from 'react';
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
import { getPresenceColor, isReadOnlyAccessLevel } from '@/lib/realtime.util';
import type { DocumentLoadResult, DocumentMeta } from '@/types/document.types';
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const DEFAULT_DOC_ID = 'default-doc';
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:1234';
const MESSAGE_ACCESS_LEVEL = 2;
const VALID_DOCUMENT_ACCESS_LEVELS: readonly DocumentAccessLevel[] = [
  'VIEW',
  'COMMENT',
  'EDIT',
  'OWNER',
];

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

export function useDocument(documentId?: string, options?: UseDocumentOptions) {
  const id = documentId || DEFAULT_DOC_ID;
  const isSharedDocument = options?.isSharedDocument === true;
  const dispatch = useAppDispatch();
  const { meta, isLoading, error } = useAppSelector((state) => state.document);
  const { isAuthenticated, accessToken, user } = useAuth();
  const [resolvedDocumentId, setResolvedDocumentId] = useState(id);
  const [accessLevel, setAccessLevel] = useState<DocumentAccessLevel | null>('EDIT');
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [realtimeProvider, setRealtimeProvider] = useState<WebsocketProvider | null>(null);
  const [errorState, setErrorState] = useState<DocumentErrorState | null>(null);

  // Track ydoc in local state so the component re-renders
  // when a new document is loaded (instead of reading from
  // the module-level singleton at render time, which may be stale)
  const [ydoc, setLocalYDoc] = useState<Y.Doc | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDoc() {
      try {
        dispatch(setLoading(true));
        dispatch(setError(null));
        setErrorState(null);

        let effectiveId = id;
        let result: DocumentLoadResult;
        let guestAccessLevel: DocumentAccessLevel = 'EDIT';

        if (isAuthenticated && accessToken) {
          if (id === DEFAULT_DOC_ID) {
            const docsPage = await documentService.listCloudDocuments(accessToken, 0, 1);
            const docs = docsPage.items;

            if (docs.length > 0) {
              effectiveId = docs[0].id;
              result = await documentService.getCloudDocument(effectiveId, accessToken);
            } else {
              const localDocs = await documentService.getAllLocalDocuments();

              if (localDocs.length > 0) {
                const mostRecentLocalDoc = [...localDocs].sort((a, b) => {
                  const updatedAtDiff =
                    new Date(b.meta.updatedAt).getTime() - new Date(a.meta.updatedAt).getTime();
                  if (updatedAtDiff !== 0) return updatedAtDiff;
                  const createdAtDiff =
                    new Date(b.meta.createdAt).getTime() - new Date(a.meta.createdAt).getTime();
                  if (createdAtDiff !== 0) return createdAtDiff;
                  return a.id.localeCompare(b.id);
                })[0];

                const localLoaded = await documentService.loadDocument(mostRecentLocalDoc.id);

                if (localLoaded) {
                  const created = await documentService.createCloudDocument(
                    accessToken,
                    localLoaded.meta.title || 'Untitled',
                    mostRecentLocalDoc.id
                  );

                  try {
                    await documentService.saveCloudDocument(
                      created.id,
                      localLoaded.ydoc,
                      {
                        ...localLoaded.meta,
                        title: localLoaded.meta.title || 'Untitled',
                      },
                      accessToken
                    );
                  } catch (saveErr) {
                    try {
                      await documentService.deleteCloudDocumentPermanently(created.id, accessToken);
                    } catch (cleanupErr) {
                      console.error(
                        'Failed to rollback partially-created cloud document after migration save failure:',
                        cleanupErr
                      );
                    }

                    throw saveErr;
                  }

                  effectiveId = created.id;
                  result = await documentService.getCloudDocument(effectiveId, accessToken);
                } else {
                  const created = await documentService.createCloudDocument(accessToken);
                  effectiveId = created.id;
                  result = { ydoc: created.ydoc, meta: created.meta };
                }
              } else {
                const created = await documentService.createCloudDocument(accessToken);
                effectiveId = created.id;
                result = { ydoc: created.ydoc, meta: created.meta };
              }
            }
          } else {
            result = await documentService.getCloudDocument(id, accessToken);
          }
        } else {
          if (id === DEFAULT_DOC_ID) {
            result = await documentService.getOrCreateDocument(id);
          } else if (isSharedDocument) {
            result = await documentService.getPublicDocument(id);
            guestAccessLevel = 'VIEW';
          } else {
            const localResult = await documentService.loadDocument(id);

            if (localResult) {
              result = localResult;
            } else {
              try {
                result = await documentService.getPublicDocument(id);
                guestAccessLevel = 'VIEW';
              } catch (publicErr) {
                if (
                  !(publicErr instanceof DocumentServiceApiError) ||
                  (publicErr.status !== 403 && publicErr.status !== 404)
                ) {
                  throw publicErr;
                }

                result = await documentService.getOrCreateDocument(id);
              }
            }
          }
        }

        if (!cancelled) {
          if (isAuthenticated && accessToken) {
            try {
              const myAccess = await documentService.getMyAccess(effectiveId, accessToken);
              if (!myAccess.allowed || !myAccess.accessLevel) {
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
              setAccessLevel(myAccess.accessLevel);
            } catch (accessErr) {
              if (
                accessErr instanceof DocumentServiceApiError &&
                (accessErr.status === 403 || accessErr.status === 404)
              ) {
                const restrictedError = buildDocumentErrorState(accessErr);
                setErrorState(restrictedError);
                setLocalYDoc(null);
                setYDoc(null);
                dispatch(clearDocument());
                dispatch(setError(restrictedError.description));
                setAccessLevel(null);
                return;
              }

              // Access lookup is advisory for UI state; do not block document load on transient errors.
              console.warn('Unable to fetch document access level, defaulting to EDIT:', accessErr);
              setAccessLevel('EDIT');
            }
          } else {
            setAccessLevel(guestAccessLevel);
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
  }, [id, dispatch, isAuthenticated, accessToken, isSharedDocument]);

  useEffect(() => {
    if (!REALTIME_URL || !ydoc || !resolvedDocumentId || !isAuthenticated || !accessToken) {
      setIsRealtimeConnected(false);
      setRealtimeProvider(null);
      return;
    }

    const provider = new WebsocketProvider(REALTIME_URL, resolvedDocumentId, ydoc, {
      params: {
        token: accessToken,
      },
    });

    const statusHandler = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      setIsRealtimeConnected(event.status === 'connected');
    };

    provider.on('status', statusHandler);
    setRealtimeProvider(provider);

    const userName = user?.displayName || user?.email || meta?.createdBy || 'NextDocs User';
    const colorSeed = user?.id || user?.email || `${resolvedDocumentId}:${userName}`;
    provider.awareness.setLocalStateField('user', {
      name: userName,
      color: getPresenceColor(colorSeed),
    });

    return () => {
      provider.off('status', statusHandler);
      provider.destroy();
      setIsRealtimeConnected(false);
      setRealtimeProvider(null);
    };
  }, [
    ydoc,
    resolvedDocumentId,
    isAuthenticated,
    accessToken,
    meta?.createdBy,
    user?.id,
    user?.email,
    user?.displayName,
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
  }, [realtimeProvider, isRealtimeConnected]);

  // Periodically revalidate access level to detect downgrades immediately
  useEffect(() => {
    if (
      !isAuthenticated ||
      !accessToken ||
      !resolvedDocumentId ||
      resolvedDocumentId === DEFAULT_DOC_ID
    ) {
      return;
    }

    const checkAccessLevel = async () => {
      try {
        const myAccess = await documentService.getMyAccess(resolvedDocumentId, accessToken);
        if (!myAccess.allowed || !myAccess.accessLevel) {
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
        setAccessLevel(myAccess.accessLevel);
      } catch (err) {
        if (err instanceof DocumentServiceApiError && (err.status === 403 || err.status === 404)) {
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
  }, [isAuthenticated, accessToken, resolvedDocumentId, dispatch]);

  const updateMeta = useCallback(
    (updates: Partial<DocumentMeta>) => {
      if (!meta) {
        console.warn('Cannot update meta: meta is null');
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

      const persistPromise =
        isAuthenticated && accessToken
          ? documentService.updateCloudMetadata(resolvedDocumentId, updates, accessToken)
          : documentService.updateMetadata(resolvedDocumentId, updates);

      persistPromise.catch((err) => {
        console.error('Failed to persist metadata update:', err);
        dispatch(updateMetaAction({ ...previousMeta, updatedAt: previousMeta.updatedAt }));
      });
    },
    [meta, dispatch, isAuthenticated, accessToken, resolvedDocumentId]
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
