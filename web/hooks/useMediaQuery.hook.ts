'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Viewport width below which the app switches to its mobile layout: the
 * navigation rail becomes an off-canvas drawer and the toolbars reflow.
 *
 * Kept as a single source of truth because it must match the `767px` media
 * queries in `styles/globals.css` (Tailwind's `md` breakpoint starts at 768px).
 * Editor chrome is decided by `TOUCH_INPUT_QUERY` instead, not by width.
 */
export const MOBILE_LAYOUT_QUERY = '(max-width: 767px)';

/**
 * Matches when the primary input mechanism is a finger rather than a mouse:
 * `pointer: coarse` (low accuracy) plus `hover: none` (nothing to hover with).
 * The pair is the conventional way to describe a phone or tablet; `pointer:
 * coarse` on its own also matches hybrids that still have hover.
 *
 * The editor chrome keys off this instead of the viewport width: the docked
 * formatting toolbar and the block side menu are about what can be tapped or
 * hovered, while `MOBILE_LAYOUT_QUERY` stays about how much room there is.
 */
export const TOUCH_INPUT_QUERY = '(pointer: coarse) and (hover: none)';

const noopSubscribe = () => () => {};

function getMediaQueryList(query: string): MediaQueryList | null {
  // jsdom (Jest) has no matchMedia, and it is also absent during SSR.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  return window.matchMedia(query);
}

/**
 * Subscribes to a CSS media query. Always returns `false` on the server and in
 * environments without `matchMedia`, so markup stays hydration-safe.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = getMediaQueryList(query);
      if (!mediaQueryList) {
        return noopSubscribe();
      }

      mediaQueryList.addEventListener('change', onStoreChange);
      return () => mediaQueryList.removeEventListener('change', onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => getMediaQueryList(query)?.matches ?? false, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** True while the app should render its mobile layout (drawer navigation). */
export function useIsMobileLayout(): boolean {
  return useMediaQuery(MOBILE_LAYOUT_QUERY);
}

/** True while the primary input is a finger, so the editor drops mouse chrome. */
export function useIsTouchInput(): boolean {
  return useMediaQuery(TOUCH_INPUT_QUERY);
}
