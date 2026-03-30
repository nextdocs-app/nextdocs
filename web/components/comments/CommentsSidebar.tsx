import { CommentsExtension } from '@blocknote/core/comments';
import { useEffect, useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { ThreadsSidebar, useExtension, useThreads } from '@blocknote/react';
import type { CommentsFilter, CommentsSort } from '@/components/comments/CommentProvider';
import { CommentsSidebarHeader } from '@/components/comments/CommentsSidebarHeader';

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
    (onStoreChange) => comments.userStore.subscribe(() => onStoreChange()),
    () => resolvedByUserIds.map((id) => comments.userStore.getUser(id)?.id ?? '').join('|'),
    () => ''
  );

  // Re-evaluated on each render; rerenders are driven by userStore subscription above.
  const missingResolvedByUserIds = resolvedByUserIds.filter(
    (id) => !comments.userStore.getUser(id)
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (missingResolvedByUserIds.length === 0) {
      return;
    }

    comments.userStore.loadUsers(missingResolvedByUserIds).catch((error) => {
      console.warn('Failed to preload resolved thread users:', error);
    });
  }, [comments.userStore, isOpen, missingResolvedByUserIds]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const hasThreads = stats.all > 0;
  const sidebarStyle: CSSProperties = {
    width: 'var(--nd-comments-rail-width, 20rem)',
    maxWidth: 'var(--nd-comments-rail-width, 20rem)',
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
          canComment={canComment}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          onClose={onClose}
        />

        <div className="nd-comments-sidebar__body">
          {hasThreads && missingResolvedByUserIds.length === 0 ? (
            <ThreadsSidebar filter={filter} sort={sort} maxCommentsBeforeCollapse={4} />
          ) : hasThreads ? (
            <div className="nd-comments-empty" role="status" aria-live="polite">
              <h3 className="nd-comments-empty__title">Loading comments…</h3>
              <p className="nd-comments-empty__description">
                Preparing thread participant details.
              </p>
            </div>
          ) : (
            <div className="nd-comments-empty" role="status" aria-live="polite">
              <h3 className="nd-comments-empty__title">No comment threads yet</h3>
              <p className="nd-comments-empty__description">
                {canComment
                  ? 'Highlight text and use the Comment action in the toolbar to start the first discussion.'
                  : 'You can view threads here once collaborators add comments.'}
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
