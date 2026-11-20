import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  applySidebarWidth,
  clampSidebarWidth,
  readAppliedSidebarWidth,
} from '@/lib/sidebar-width.util';

/**
 * Drag-to-resize for the navigation rail.
 *
 * The width itself is not React state: it is the `--nd-sidebar-width` custom
 * property, resolved before the first paint by the head script in the root
 * layout. A drag writes that property straight to the DOM (rAF-coalesced) and
 * the drag end persists it, so there is nothing here for React to render and no
 * source of truth that can disagree with the painted rail.
 */
export function useSidebarResize() {
  const [isResizing, setIsResizing] = useState(false);
  // Seeded on every drag start from what is painted; nothing reads it before then.
  const widthRef = useRef<number>(SIDEBAR_DEFAULT_WIDTH);
  const rafRef = useRef<number | null>(null);

  // Lock body styles & classes during resizing; clean up on finish or unmount
  useEffect(() => {
    if (!isResizing) return;

    if (typeof document !== 'undefined') {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.body.classList.add('nd-sidebar-resizing');
      document.documentElement.classList.add('nd-sidebar-resizing');
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.body.classList.remove('nd-sidebar-resizing');
        document.documentElement.classList.remove('nd-sidebar-resizing');
      }
    };
  }, [isResizing]);

  const startResizing = useCallback((e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.();
    // The rail may have been moved since mount (another tab, a previous drag),
    // so start from what is actually painted.
    widthRef.current = readAppliedSidebarWidth();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    const finalWidth = widthRef.current;
    if (typeof document !== 'undefined') {
      applySidebarWidth(finalWidth);
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsResizing(false);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(finalWidth));
    } catch {
      // Storage access might be restricted.
    }
  }, []);

  const resize = useCallback((e: MouseEvent | PointerEvent) => {
    widthRef.current = clampSidebarWidth(e.clientX);
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      // Sidebar and breadcrumbs both follow instantly; the 200ms width
      // transition is disabled while resizing.
      applySidebarWidth(widthRef.current);
    });
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

    if (hasPointer) {
      window.addEventListener('pointermove', resize);
      window.addEventListener('pointerup', stopResizing);
      window.addEventListener('pointercancel', stopResizing);
    } else {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }

    return () => {
      if (hasPointer) {
        window.removeEventListener('pointermove', resize);
        window.removeEventListener('pointerup', stopResizing);
        window.removeEventListener('pointercancel', stopResizing);
      } else {
        window.removeEventListener('mousemove', resize);
        window.removeEventListener('mouseup', stopResizing);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isResizing, resize, stopResizing]);

  return {
    isResizing,
    startResizing,
  };
}
