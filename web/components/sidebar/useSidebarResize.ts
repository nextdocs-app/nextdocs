import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '@/stores/hooks';
import { setSidebarWidth as setSidebarWidthAction } from '@/stores/sidebar/sidebar.slice';

export function useSidebarResize(initialWidth = 256, minWidth = 256, maxWidth = 480) {
  const dispatch = useAppDispatch();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nextdocs-sidebar-width');
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
            return parsed;
          }
        }
      } catch {
        // Storage access might be restricted (e.g. private browsing or sandbox)
      }
    }
    return initialWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(sidebarWidth);
  const rafRef = useRef<number | null>(null);

  // Keep ref in sync when not resizing
  useEffect(() => {
    if (!isResizing) {
      widthRef.current = sidebarWidth;
    }
  }, [sidebarWidth, isResizing]);

  // Sync to DOM + Redux only when not dragging (or on mount)
  useEffect(() => {
    if (isResizing) return;
    dispatch(setSidebarWidthAction(sidebarWidth));
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--nd-sidebar-width', `${sidebarWidth}px`);
    }
  }, [sidebarWidth, dispatch, isResizing]);

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
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    const finalWidth = widthRef.current;
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--nd-sidebar-width', `${finalWidth}px`);
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setSidebarWidth(finalWidth);
    setIsResizing(false);
    try {
      localStorage.setItem('nextdocs-sidebar-width', String(finalWidth));
    } catch {
      // Storage access might be restricted.
    }
  }, []);

  const resize = useCallback(
    (e: MouseEvent | PointerEvent) => {
      const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX));
      widthRef.current = newWidth;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        // Update CSS var — sidebar and breadcrumbs both follow instantly (transition disabled via body class)
        document.documentElement.style.setProperty('--nd-sidebar-width', `${widthRef.current}px`);
      });
    },
    [minWidth, maxWidth]
  );

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
    sidebarWidth,
    isResizing,
    startResizing,
  };
}
