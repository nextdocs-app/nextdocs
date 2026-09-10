'use client';

import { useSyncExternalStore } from 'react';
import type { CommentsFilter, CommentsSort } from '@/components/comments/CommentProvider';
import type { CommentThreadStats } from '@/components/comments/CommentsSidebar';
import { Close } from '@/icons';

function getIsMacSnapshot(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
}

function noopSubscribe() {
  return () => {};
}

const FILTER_OPTIONS: Array<{ value: CommentsFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const SORT_OPTIONS: Array<{ value: CommentsSort; label: string }> = [
  { value: 'position', label: 'By position' },
  { value: 'recent-activity', label: 'Recent activity' },
  { value: 'oldest', label: 'Oldest first' },
];

type CommentsSidebarHeaderProps = {
  filter: CommentsFilter;
  sort: CommentsSort;
  stats: CommentThreadStats;
  onFilterChange: (filter: CommentsFilter) => void;
  onSortChange: (sort: CommentsSort) => void;
  onClose: () => void;
};

export function CommentsSidebarHeader({
  filter,
  sort,
  stats,
  onFilterChange,
  onSortChange,
  onClose,
}: CommentsSidebarHeaderProps) {
  const isMac = useSyncExternalStore(noopSubscribe, getIsMacSnapshot, () => true);

  const countsByFilter: Record<CommentsFilter, number> = {
    open: stats.open,
    resolved: stats.resolved,
    all: stats.all,
  };

  return (
    <div className="nd-comments-sidebar__header">
      <div className="nd-comments-sidebar__top">
        <div className="nd-comments-sidebar__title-wrap">
          <h2 className="nd-comments-sidebar__title">Comments</h2>
        </div>

        <div className="nd-comments-sidebar__top-actions">
          <div className="relative inline-flex items-center">
            <select
              aria-label="Sort comment threads"
              className="nd-comments-sort"
              value={sort}
              onChange={(event) => onSortChange(event.target.value as CommentsSort)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="nd-comments-sidebar__close"
            aria-label="Close comments sidebar"
          >
            <Close size={13} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div
        className="nd-comments-filter nd-comments-filter--full"
        role="tablist"
        aria-label="Comment thread filter"
      >
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => onFilterChange(option.value)}
            className={`nd-comments-filter__tab ${filter === option.value ? 'nd-active' : ''}`}
          >
            <span>{option.label}</span>
            <span className="nd-comments-filter__count" aria-hidden="true">
              {countsByFilter[option.value]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground/75 px-0.5 pt-0.5">
        <span className="font-normal">Keyboard shortcut</span>
        <kbd
          suppressHydrationWarning
          className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border/70 bg-muted/60 text-muted-foreground font-medium select-none"
        >
          {isMac ? '⌘⌥⇧A' : 'Ctrl+Alt+Shift+A'}
        </kbd>
      </div>
    </div>
  );
}
