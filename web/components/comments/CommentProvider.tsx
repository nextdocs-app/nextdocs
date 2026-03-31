'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type CommentsFilter = 'open' | 'resolved' | 'all';
export type CommentsSort = 'position' | 'recent-activity' | 'oldest';

type CommentsUIContextValue = {
  isSidebarOpen: boolean;
  filter: CommentsFilter;
  sort: CommentsSort;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  setFilter: (filter: CommentsFilter) => void;
  setSort: (sort: CommentsSort) => void;
};

const CommentsUIContext = createContext<CommentsUIContextValue | null>(null);

export function CommentProvider({ children }: { children: ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [filter, setFilter] = useState<CommentsFilter>('open');
  const [sort, setSort] = useState<CommentsSort>('position');

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((previous) => !previous);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shouldToggle =
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 'a';

      if (!shouldToggle) {
        return;
      }

      event.preventDefault();
      toggleSidebar();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggleSidebar]);

  const value = useMemo(
    () => ({
      isSidebarOpen,
      filter,
      sort,
      openSidebar,
      closeSidebar,
      toggleSidebar,
      setFilter,
      setSort,
    }),
    [isSidebarOpen, filter, sort, openSidebar, closeSidebar, toggleSidebar]
  );

  return <CommentsUIContext.Provider value={value}>{children}</CommentsUIContext.Provider>;
}

export function useCommentUI() {
  const context = useContext(CommentsUIContext);

  if (!context) {
    throw new Error('useCommentUI must be used within a CommentProvider');
  }

  return context;
}
