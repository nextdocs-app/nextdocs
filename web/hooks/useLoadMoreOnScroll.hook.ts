'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface LoadMoreOnScroll {
  /** Attach to the marker element that sits past the last item. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** False without an IntersectionObserver: the caller renders its own control. */
  isSupported: boolean;
}

/**
 * Reveals the next page when the sentinel element scrolls into view.
 *
 * The observer follows the sentinel's *lifecycle* through a callback ref rather
 * than reading a ref object inside an effect. A sentinel is typically
 * conditional — the icon grid only renders one once the catalog and the glyph
 * bundle have both arrived — and an effect that runs before the node exists has
 * nothing to observe; a dependency array cannot see a mount it did not cause.
 * That is what parked the picker on "Loading more icons…" until some unrelated
 * re-render (a search keystroke, a category switch) happened to re-run the
 * effect and finally attach the observer.
 *
 * `revision` is the consumer's growth counter, and the observer is rebuilt
 * whenever it changes: IntersectionObserver reports *crossings*, so a revealed
 * page that still leaves the sentinel on screen produces no further
 * notification — the next page only appeared after scrolling away and back.
 * Re-observing makes the browser report the sentinel's current position once
 * per reveal, so the list keeps filling until the sentinel drops below the fold
 * or the consumer runs out of items and unmounts it.
 */
export function useLoadMoreOnScroll({
  rootRef,
  enabled,
  revision,
  onReachEnd,
  rootMargin = '160px',
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  revision: number;
  onReachEnd: () => void;
  rootMargin?: string;
}): LoadMoreOnScroll {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  // Held in a ref so a consumer passing a fresh closure every render cannot
  // rebuild the observer every render — at the bottom edge that would reveal a
  // page per render instead of a page per crossing.
  const onReachEndRef = useRef(onReachEnd);
  useEffect(() => {
    onReachEndRef.current = onReachEnd;
  }, [onReachEnd]);

  const isSupported =
    typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';

  useEffect(() => {
    if (!enabled || !sentinel || !isSupported) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onReachEndRef.current();
        }
      },
      { root: rootRef.current, rootMargin }
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [enabled, sentinel, revision, isSupported, rootRef, rootMargin]);

  // Stable identity: a callback ref that changes identity makes React detach
  // (null) and re-attach the node on every render, tearing down and rebuilding
  // the observer once per keystroke.
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    setSentinel(node);
  }, []);

  return { sentinelRef, isSupported };
}
