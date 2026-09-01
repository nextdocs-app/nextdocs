import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch } from '@/stores/hooks';
import { setSidebarWidth as setSidebarWidthAction } from '@/stores/sidebar/sidebar.slice';

export function useSidebarResize(initialWidth = 256, minWidth = 256, maxWidth = 480) {
  const dispatch = useAppDispatch();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('nextdocs-sidebar-width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return initialWidth;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    dispatch(setSidebarWidthAction(sidebarWidth));
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--nd-sidebar-width', `${sidebarWidth}px`);
    }
  }, [sidebarWidth, dispatch]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX));
      setSidebarWidth(newWidth);
      localStorage.setItem('nextdocs-sidebar-width', String(newWidth));
    },
    [isResizing, minWidth, maxWidth]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  return {
    sidebarWidth,
    isResizing,
    startResizing,
  };
}
