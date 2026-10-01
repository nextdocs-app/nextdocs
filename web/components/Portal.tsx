import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

const emptySubscribe = () => () => {};

/**
 * Renders its children into `document.body`.
 *
 * Overlays declared inside the navigation drawer cannot rely on
 * `position: fixed` to reach the viewport: the drawer slides with a `transform`
 * below the `md` breakpoint, which makes the drawer the containing block for
 * every fixed descendant and lets its own `overflow` clip them. Portalling
 * keeps those overlays anchored to the viewport (and above the drawer) no
 * matter which component declares them.
 *
 * Mounted state ensures hydration safety by matching the initial SSR null render.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  if (!isMounted || typeof document === 'undefined') {
    return null;
  }

  return createPortal(children, document.body);
}
