import { useEffect, useMemo, useRef } from 'react';
import {
  attachmentService,
  AttachmentServiceApiError,
  UnsupportedUrlError,
  type UploadedAttachment,
} from '@/services/attachment.service';
import {
  describeUploadBlockReason,
  isStoredAttachmentUrl,
  type UploadBlockReason,
} from '@/lib/attachment.util';
import type { DocumentAccessLevel } from '@/services/document.service';
import { refreshSessionThunk } from '@/stores/auth/auth.slice';
import { useAppDispatch } from '@/stores/hooks';
import { addToast } from '@/stores/toasts/toasts.slice';

const UPLOAD_BLOCK_MESSAGES: Record<UploadBlockReason, string> = {
  offline: "You're offline. File uploads need a connection.",
  unauthenticated: 'Sign in to upload files to this document.',
  syncing: 'This document is still syncing. Try again in a moment.',
  'read-only': "You don't have permission to upload files to this document.",
  trashed: 'This document is in the trash, so it cannot receive new files.',
};

/** A broken attachment must not toast on every render pass; one notice per URL per minute. */
const RESOLVE_ERROR_TOAST_INTERVAL_MS = 60_000;
/** Bound on remembered resolve errors; mirrors the service's URL cache bound. */
const RESOLVE_ERROR_TOAST_MAX_ENTRIES = 200;

/** Pasting many files must not fire an unbounded burst of parallel uploads at the API. */
const MAX_CONCURRENT_UPLOADS = 4;
/** A paste of hundreds of files must not park every File blob in memory behind the editor. */
const MAX_QUEUED_UPLOADS = 20;

const QUEUE_FULL_MESSAGE = 'Too many files are queued to upload. Try again in a moment.';
const DOCUMENT_CHANGED_MESSAGE = 'This file was queued for a document you have left.';
const INVALID_UPLOAD_URL_MESSAGE = 'The server returned a file URL that cannot be stored safely.';

/**
 * Rejection used when the editor unmounts with uploads still queued. Callers settle quietly:
 * the queue is gone rather than failed, so a post-unmount toast would land on the wrong page.
 */
export class UploadQueueCancelledError extends Error {
  constructor() {
    super('Upload queue cancelled.');
    this.name = 'UploadQueueCancelledError';
  }
}

function describeResolveError(error: unknown): string {
  if (error instanceof UnsupportedUrlError) {
    return 'A file in this document points to an unsupported URL and was not loaded.';
  }
  return 'Some files in this document could not be loaded.';
}

export function describeUploadError(error: unknown, fileName: string): string {
  if (error instanceof AttachmentServiceApiError) {
    switch (error.status) {
      case 401:
        return 'Your session expired. Sign in again to upload files.';
      case 403:
        return "You don't have permission to upload files to this document.";
      case 404:
        return 'Upload failed: the document may not have finished syncing, or your access may have changed.';
      case 413:
        // 413 covers both the per-file size ceiling and the per-user storage quota; the
        // API's message names which limit was hit, so surface it instead of guessing.
        return error.message
          ? `${fileName} was not uploaded: ${error.message}`
          : `${fileName} is larger than the server's upload limit.`;
      default:
        return error.message || 'Upload failed. Please try again.';
    }
  }
  return 'Upload failed. Please try again.';
}

/**
 * Runs `run` with the current access token, retrying once with a freshly refreshed token
 * after a 401. `run` only ever sees a signed-in token: a missing session fails before the
 * request is built. The caller sees the retry's failure, or the original 401 when no
 * refreshed token is available.
 */
export function withRefreshedToken<T>(
  run: (accessToken: string) => Promise<T>,
  getAccessToken: () => string | null,
  refreshAccessToken: () => Promise<string | null>
): Promise<T> {
  return retryOnceAfterRefresh(
    (accessToken) => {
      if (accessToken === null) {
        throw new Error('Missing access token.');
      }
      return run(accessToken);
    },
    getAccessToken,
    refreshAccessToken
  );
}

/**
 * Anonymous-tolerant variant for signed URL resolution, which share-link guests may call:
 * `run` sees `null` when nobody is signed in, and a 401 still refreshes once, since an
 * anonymous viewer can hold a refreshable session cookie. Otherwise it behaves exactly like
 * {@link withRefreshedToken}.
 */
export function withRefreshedTokenAllowingAnonymous<T>(
  run: (accessToken: string | null) => Promise<T>,
  getAccessToken: () => string | null,
  refreshAccessToken: () => Promise<string | null>
): Promise<T> {
  return retryOnceAfterRefresh(run, getAccessToken, refreshAccessToken);
}

/**
 * One attempt, then one refresh-and-retry when the attempt reports an expired session.
 * Everything else passes straight through, and a refresh that yields no token leaves the
 * original 401 as the error the caller sees.
 */
async function retryOnceAfterRefresh<T>(
  run: (accessToken: string | null) => Promise<T>,
  getAccessToken: () => string | null,
  refreshAccessToken: () => Promise<string | null>
): Promise<T> {
  const accessToken = getAccessToken();
  try {
    return await run(accessToken);
  } catch (error) {
    if (!(error instanceof AttachmentServiceApiError) || error.status !== 401) {
      throw error;
    }
    const refreshed = await refreshAccessToken();
    if (refreshed === null) {
      throw error;
    }
    return await run(refreshed);
  }
}

export interface CancellableUploadLimiter {
  limit<T>(run: () => Promise<T>): Promise<T>;
  cancelAll(): void;
}

/**
 * Bounds concurrent uploads without serializing independent files, and bounds the queue so
 * a paste of hundreds of files cannot park every File blob in memory. There is no abort
 * propagation: BlockNote's `uploadFile` accepts no signal, so a queued file can only be
 * rejected, not cancelled mid-flight. `cancelAll` exists so unmounting the editor settles
 * queued waiters instead of letting them toast on a page the user has already left.
 */
export function createCancellableLimiter(
  maxConcurrent: number,
  maxQueued: number
): CancellableUploadLimiter {
  let inFlight = 0;
  const waiting: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  return {
    async limit<T>(run: () => Promise<T>): Promise<T> {
      if (inFlight >= maxConcurrent) {
        if (waiting.length >= maxQueued) {
          throw new AttachmentServiceApiError(QUEUE_FULL_MESSAGE, 0);
        }
        await new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }));
      }
      inFlight += 1;
      try {
        return await run();
      } finally {
        inFlight -= 1;
        waiting.shift()?.resolve();
      }
    },
    cancelAll() {
      while (waiting.length > 0) {
        waiting.shift()?.reject(new UploadQueueCancelledError());
      }
    },
  };
}

/**
 * Shares one in-flight call between concurrent callers, so N blocks that all 401 at once
 * trigger one token refresh instead of N. The next call after settlement starts fresh.
 */
export function createSingleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight === null) {
      inFlight = run().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

/** Mirrors the service's bounded cache so per-URL notices cannot grow the map forever. */
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (map.size >= maxEntries && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  map.set(key, value);
}

export interface AttachmentHandlerDeps {
  documentId: string;
  isAuthenticated: boolean;
  accessToken: string | null;
  isOnline: boolean;
  accessLevel: DocumentAccessLevel | null;
  deletedAt?: string | null;
}

/**
 * File-block uploads and signed-URL resolution for BlockNote, which captures both
 * callbacks once at editor creation. `useEffectEvent` keeps the callbacks stable
 * across renders while always reading the latest auth and permission state, so the
 * editor is never rebuilt for a token rotation.
 */
export function useAttachmentHandlers({
  documentId,
  isAuthenticated,
  accessToken,
  isOnline,
  accessLevel,
  deletedAt,
}: AttachmentHandlerDeps) {
  const dispatch = useAppDispatch();

  // Mirror the volatile inputs so the stable callbacks below always read the latest
  // values without rebuilding (and without rebuilding the BlockNote editor). Synced in
  // an effect because ref writes do not belong in render; callbacks only run on user
  // actions after effects flush, and the 401 retry heals the one-commit staleness gap.
  const documentIdRef = useRef(documentId);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const accessTokenRef = useRef(accessToken);
  const isOnlineRef = useRef(isOnline);
  const accessLevelRef = useRef(accessLevel);
  const deletedAtRef = useRef(deletedAt);

  useEffect(() => {
    documentIdRef.current = documentId;
    isAuthenticatedRef.current = isAuthenticated;
    accessTokenRef.current = accessToken;
    isOnlineRef.current = isOnline;
    accessLevelRef.current = accessLevel;
    deletedAtRef.current = deletedAt;
  }, [documentId, isAuthenticated, accessToken, isOnline, accessLevel, deletedAt]);

  const limiter = useMemo(
    () => createCancellableLimiter(MAX_CONCURRENT_UPLOADS, MAX_QUEUED_UPLOADS),
    []
  );
  // Settle queued uploads when the editor goes away so their promises cannot resolve into
  // toasts on a page the user already left; in-flight uploads have no signal to abort.
  useEffect(() => () => limiter.cancelAll(), [limiter]);

  const resolveErrorAtRef = useRef(new Map<string, number>());

  return useMemo(() => {
    const refreshAccessToken = createSingleFlight(async (): Promise<string | null> => {
      const result = await dispatch(refreshSessionThunk());
      return refreshSessionThunk.fulfilled.match(result) ? result.payload.accessToken : null;
    });

    const notifyResolveError = (url: string, error: unknown) => {
      const now = Date.now();
      const last = resolveErrorAtRef.current.get(url);
      if (last === undefined || now - last >= RESOLVE_ERROR_TOAST_INTERVAL_MS) {
        setBounded(resolveErrorAtRef.current, url, now, RESOLVE_ERROR_TOAST_MAX_ENTRIES);
        dispatch(addToast({ message: describeResolveError(error), type: 'error' }));
      }
    };

    // The API keys uploads by document, not by block; BlockNote still passes the target id.
    const uploadFile = async (file: File): Promise<string> => {
      // Snapshot everything up front: the token must be the same one the eligibility
      // check approved, not whatever the ref holds when the fetch finally runs.
      const snapshot = {
        documentId: documentIdRef.current,
        isAuthenticated: isAuthenticatedRef.current,
        accessToken: accessTokenRef.current,
        isOnline: isOnlineRef.current,
        accessLevel: accessLevelRef.current,
        deletedAt: deletedAtRef.current,
      };
      const blockReason = describeUploadBlockReason({
        isAuthenticated: snapshot.isAuthenticated,
        accessToken: snapshot.accessToken,
        isOnline: snapshot.isOnline,
        accessLevel: snapshot.accessLevel,
        deletedAt: snapshot.deletedAt,
      });

      if (blockReason) {
        dispatch(addToast({ message: UPLOAD_BLOCK_MESSAGES[blockReason], type: 'error' }));
        throw new Error(UPLOAD_BLOCK_MESSAGES[blockReason]);
      }

      let attachment: UploadedAttachment;
      try {
        attachment = await withRefreshedToken(
          (token) =>
            limiter.limit(() => {
              // The queue can hold a file for minutes; uploading into a document the user
              // has since left would attach it to the wrong place.
              if (documentIdRef.current !== snapshot.documentId) {
                throw new AttachmentServiceApiError(DOCUMENT_CHANGED_MESSAGE, 0);
              }
              return attachmentService.uploadAttachment(snapshot.documentId, file, token);
            }),
          () => snapshot.accessToken,
          refreshAccessToken
        );
      } catch (error) {
        // A cancelled queue is expected on unmount; it must not toast after teardown.
        if (error instanceof UploadQueueCancelledError) {
          throw error;
        }
        dispatch(addToast({ message: describeUploadError(error, file.name), type: 'error' }));
        throw error;
      }

      // Blocks store the host-independent path; anything else would write a perishable or
      // foreign URL into permanent Yjs history.
      if (!isStoredAttachmentUrl(attachment.url)) {
        dispatch(addToast({ message: INVALID_UPLOAD_URL_MESSAGE, type: 'error' }));
        throw new AttachmentServiceApiError(INVALID_UPLOAD_URL_MESSAGE, 0);
      }
      return attachment.url;
    };

    const resolveFileUrl = async (url: string): Promise<string> => {
      // Offline renders cannot reach the mint endpoint; failing quietly avoids one toast
      // per file on every render pass.
      if (!isOnlineRef.current) {
        throw new AttachmentServiceApiError('File previews need a connection.', 0);
      }
      try {
        return await withRefreshedTokenAllowingAnonymous(
          (token) => attachmentService.resolveAttachmentUrl(url, token),
          () => accessTokenRef.current,
          refreshAccessToken
        );
      } catch (error) {
        notifyResolveError(url, error);
        throw error;
      }
    };

    return { uploadFile, resolveFileUrl };
  }, [dispatch, limiter]);
}
