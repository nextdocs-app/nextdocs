'use client';

import { useEffect, useRef, useState } from 'react';
import { attachmentService } from '@/services/attachment.service';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';
import { isAttachmentId, isHttpsUrl, storedAttachmentUrl } from '@/lib/document-icon.util';
import type { DocumentCover, DocumentIcon } from '@/types/document.types';

/** Anything renderable as a page image: an icon's or cover's type/value pair. */
export type ResolvableAsset =
  Pick<DocumentIcon, 'type' | 'value'> | Pick<DocumentCover, 'type' | 'value'> | null | undefined;

/**
 * Displayable URL for a page icon/cover value.
 *
 * Links are already absolute. Uploads are stored as attachment ids, so their
 * short-lived signed URL is minted on demand — and re-minted when it expires —
 * through the same cached resolver file blocks use.
 *
 * The resolved URL is kept next to the key it was minted for, so a resolution
 * that lands after the icon/cover changed is discarded instead of flashing a
 * stale image.
 */
export function useResolvedAssetUrl(
  asset: ResolvableAsset,
  accessToken: string | null
): string | null {
  const type = asset?.type ?? null;
  const rawValue = asset?.value ?? null;
  // Re-validate here instead of trusting pre-sanitized input: a hand-crafted Yjs
  // value bypasses REST validation, so a path-ish upload id or a
  // javascript:/data: link must never reach fetch or img src.
  const trimmedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
  const safeUploadValue = type === 'upload' && isAttachmentId(trimmedValue) ? trimmedValue : null;
  const isUpload = safeUploadValue !== null;
  const cacheKey = isUpload ? `${safeUploadValue}\n${accessToken ?? ''}` : null;
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null);
  const { isOnline } = useNetworkStatus();
  // Bumped on offline→online transitions so an offline failure (which stores
  // url: null for the key — a negative cache with no TTL at this layer) is
  // re-attempted on reconnect instead of stranding the placeholder.
  const [retryGeneration, setRetryGeneration] = useState(0);
  const wasOnlineRef = useRef(isOnline);

  useEffect(() => {
    if (!wasOnlineRef.current && isOnline) {
      setRetryGeneration((prev) => prev + 1);
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    if (!cacheKey || !safeUploadValue) {
      return;
    }
    // Don't burn a resolution attempt while offline: it can only fail, and
    // the failure would negative-cache (here and in the service) a URL that
    // would have resolved a moment later.
    if (!isOnline) {
      return;
    }

    let cancelled = false;
    attachmentService
      .resolveAttachmentUrl(storedAttachmentUrl(safeUploadValue), accessToken)
      .then((url) => {
        if (!cancelled) {
          setResolved({ key: cacheKey, url });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.warn('Failed to resolve page image:', error);
          setResolved({ key: cacheKey, url: null });
        }
      });

    return () => {
      cancelled = true;
    };
    // `isOnline` drives `retryGeneration` above rather than appearing here, so
    // a reconnect re-attempts exactly once instead of firing one run per dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, safeUploadValue, accessToken, retryGeneration]);

  if (type === 'link') {
    return trimmedValue && isHttpsUrl(trimmedValue) ? trimmedValue : null;
  }
  if (!cacheKey) {
    return null;
  }
  return resolved?.key === cacheKey ? resolved.url : null;
}
