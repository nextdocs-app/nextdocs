import { CommentsExtension } from '@blocknote/core/comments';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { ThreadsSidebar, useExtension, useExtensionState, useThreads } from '@blocknote/react';
import type { CommentsFilter, CommentsSort } from '@/components/comments/CommentProvider';
import { CommentsSidebarHeader } from '@/components/comments/CommentsSidebarHeader';
import { CircleCheck, Comments as CommentsIcon } from '@/icons';

export type CommentThreadStats = {
  open: number;
  resolved: number;
  all: number;
};

type CommentsSidebarProps = {
  isOpen: boolean;
  filter: CommentsFilter;
  sort: CommentsSort;
  onFilterChange: (filter: CommentsFilter) => void;
  onSortChange: (sort: CommentsSort) => void;
  onClose: () => void;
  onThreadStatsChange?: (stats: CommentThreadStats) => void;
  canComment?: boolean;
};

export function CommentsSidebar({
  isOpen,
  filter,
  sort,
  onFilterChange,
  onSortChange,
  onClose,
  onThreadStatsChange,
  canComment = true,
}: CommentsSidebarProps) {
  const comments = useExtension(CommentsExtension);
  const threads = useThreads();
  // Tracks the thread selected in the editor (e.g. user clicked a comment
  // mark) so the sidebar can scroll to it and expand it. Selecting only
  // `selectedThreadId` avoids re-scrolling on unrelated position updates.
  const selectedThreadId = useExtensionState(CommentsExtension, {
    selector: (state) => state.selectedThreadId,
  });
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (!isOpen) {
      document.body.removeAttribute('data-comments-sidebar-open');
      return;
    }

    document.body.setAttribute('data-comments-sidebar-open', 'true');

    return () => {
      document.body.removeAttribute('data-comments-sidebar-open');
    };
  }, [isOpen]);

  const stats = useMemo<CommentThreadStats>(() => {
    let open = 0;
    let resolved = 0;

    for (const thread of threads.values()) {
      if (thread.resolved) {
        resolved += 1;
      } else {
        open += 1;
      }
    }

    return {
      open,
      resolved,
      all: open + resolved,
    };
  }, [threads]);

  useEffect(() => {
    onThreadStatsChange?.(stats);
  }, [onThreadStatsChange, stats]);

  const resolvedByUserIds = useMemo(() => {
    const ids = new Set<string>();

    for (const thread of threads.values()) {
      if (thread.resolved && thread.resolvedBy) {
        ids.add(thread.resolvedBy);
      }
    }

    return Array.from(ids).sort();
  }, [threads]);

  useSyncExternalStore(
    (onStoreChange) => comments.userStore.store.subscribe(() => onStoreChange()),
    () => resolvedByUserIds.map((id) => comments.userStore.getUser(id)?.id ?? '').join('|'),
    () => ''
  );

  // Re-evaluated on each render; rerenders are driven by userStore subscription above.
  const missingResolvedByUserIds = resolvedByUserIds.filter(
    (id) => !comments.userStore.getUser(id)
  );
  const missingResolvedByUserIdsKey = missingResolvedByUserIds.join('|');
  const [preloadFailedKey, setPreloadFailedKey] = useState<string | null>(null);
  const hasPreloadError = Boolean(
    missingResolvedByUserIdsKey && preloadFailedKey === missingResolvedByUserIdsKey
  );

  useEffect(() => {
    if (!isOpen || !missingResolvedByUserIdsKey) {
      return;
    }

    let cancelled = false;
    const idsToLoad = missingResolvedByUserIdsKey.split('|');
    comments.userStore.loadUsers(idsToLoad).catch((error) => {
      if (!cancelled) {
        setPreloadFailedKey(missingResolvedByUserIdsKey);
      }
      console.warn('Failed to preload resolved thread users:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [comments.userStore, isOpen, missingResolvedByUserIdsKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  // Track previously handled selectedThreadId so the filter is only auto-expanded
  // when a new thread is selected in the editor, and not when the user manually
  // switches filter tabs or resolves a thread.
  const prevSelectedThreadIdRef = useRef<string | undefined>(undefined);

  // When a comment mark is clicked in the editor, BlockNote sets
  // `selectedThreadId` (floating thread UI is disabled while the sidebar is
  // open, so only the sidebar copy expands). Ensure the thread passes the
  // active filter so it can be scrolled to, then scroll it into view.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!selectedThreadId) {
      prevSelectedThreadIdRef.current = selectedThreadId;
      return;
    }

    if (selectedThreadId !== prevSelectedThreadIdRef.current) {
      const thread = threads.get(selectedThreadId);
      if (!thread) {
        return;
      }

      prevSelectedThreadIdRef.current = selectedThreadId;

      const matchesFilter =
        filter === 'all' ||
        (filter === 'open' && !thread.resolved) ||
        (filter === 'resolved' && thread.resolved);

      if (!matchesFilter) {
        onFilterChange('all');
      }
    }
  }, [isOpen, selectedThreadId, threads, filter, onFilterChange]);

  useEffect(() => {
    if (!isOpen || !selectedThreadId) {
      return;
    }

    let frameId: number | undefined;
    let attempts = 0;
    const maxAttempts = 10;

    const tryScroll = () => {
      const container = bodyRef.current;
      if (!container) {
        return;
      }

      // ThreadsSidebar marks the expanded thread via shadcn's `bg-accent`
      // Card style (with `.bn-thread-composer`, `.selected`, or data attribute fallbacks).
      const selected = container.querySelector<HTMLElement>(
        '.bn-threads-sidebar .bn-thread:has(.bn-thread-composer), ' +
          '.bn-threads-sidebar .bn-thread.bg-accent, ' +
          '.bn-threads-sidebar .bn-thread.selected, ' +
          '.bn-threads-sidebar .bn-thread[data-selected="true"]'
      );

      if (selected) {
        const containerRect = container.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        const relativeTop = selectedRect.top - containerRect.top;
        const targetScrollTop =
          container.scrollTop + relativeTop - container.clientHeight / 2 + selectedRect.height / 2;

        if (typeof container.scrollTo === 'function') {
          container.scrollTo({
            top: Math.max(0, targetScrollTop),
            behavior: 'smooth',
          });
        } else {
          container.scrollTop = Math.max(0, targetScrollTop);
        }
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        frameId = requestAnimationFrame(tryScroll);
      }
    };

    frameId = requestAnimationFrame(tryScroll);

    return () => {
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [isOpen, selectedThreadId, threads, filter, sort]);

  if (!isOpen) {
    return null;
  }

  const hasThreads = stats.all > 0;
  const filteredCount =
    filter === 'open' ? stats.open : filter === 'resolved' ? stats.resolved : stats.all;

  const sidebarStyle: CSSProperties = {
    width: 'var(--nd-comments-rail-width, 22rem)',
    maxWidth: 'var(--nd-comments-rail-width, 22rem)',
    boxShadow: 'none',
  };

  return (
    <>
      <button
        type="button"
        className="nd-comments-backdrop"
        aria-label="Close comments sidebar"
        onClick={onClose}
      />
      <aside
        className="nd-comments-sidebar"
        role="complementary"
        aria-label="Document comments"
        style={sidebarStyle}
      >
        <CommentsSidebarHeader
          filter={filter}
          sort={sort}
          stats={stats}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          onClose={onClose}
        />

        <div ref={bodyRef} className="nd-comments-sidebar__body">
          {hasThreads &&
          (filter === 'open' || missingResolvedByUserIds.length === 0 || hasPreloadError) &&
          filteredCount > 0 ? (
            <ThreadsSidebar filter={filter} sort={sort} maxCommentsBeforeCollapse={4} />
          ) : hasThreads &&
            filter !== 'open' &&
            missingResolvedByUserIds.length > 0 &&
            !hasPreloadError ? (
            <div className="nd-comments-empty" role="status" aria-live="polite">
              <div className="flex flex-col items-center justify-center text-center p-6 gap-2">
                <div className="size-5 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
                <h3 className="nd-comments-empty__title text-sm font-medium mt-2">
                  Loading comments…
                </h3>
                <p className="nd-comments-empty__description text-xs text-muted-foreground">
                  Preparing thread participant details.
                </p>
              </div>
            </div>
          ) : filter === 'open' && stats.all > 0 ? (
            <div className="nd-comments-empty" role="status" aria-live="polite">
              <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2">
                <div className="size-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-1 border border-emerald-500/20">
                  <CircleCheck size={20} strokeWidth={1.75} />
                </div>
                <h3 className="nd-comments-empty__title text-sm font-medium text-foreground">
                  All caught up!
                </h3>
                <p className="nd-comments-empty__description text-xs text-muted-foreground leading-relaxed max-w-[240px]">
                  No open comment threads on this document.
                </p>
              </div>
            </div>
          ) : filter === 'resolved' && stats.all > 0 ? (
            <div className="nd-comments-empty" role="status" aria-live="polite">
              <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2">
                <div className="size-10 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground/70 mb-1 border border-border/50">
                  <CircleCheck size={20} strokeWidth={1.5} />
                </div>
                <h3 className="nd-comments-empty__title text-sm font-medium text-foreground">
                  No resolved threads
                </h3>
                <p className="nd-comments-empty__description text-xs text-muted-foreground leading-relaxed max-w-[240px]">
                  Threads marked as resolved will be archived here.
                </p>
              </div>
            </div>
          ) : (
            <div className="nd-comments-empty" role="status" aria-live="polite">
              <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2">
                <div className="size-10 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground/70 mb-1 border border-border/50">
                  <CommentsIcon size={20} strokeWidth={1.5} />
                </div>
                <h3 className="nd-comments-empty__title text-sm font-medium text-foreground">
                  No comment threads yet
                </h3>
                <p className="nd-comments-empty__description text-xs text-muted-foreground leading-relaxed max-w-[240px]">
                  {canComment
                    ? 'Highlight text in the editor and click Comment to start a discussion.'
                    : 'Threads will appear here once collaborators add comments.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
