import type { CommentsFilter, CommentsSort } from '@/components/comments/CommentProvider';
import type { CommentThreadStats } from '@/components/comments/CommentsSidebar';
import { Close } from '@/icons';

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
  canComment: boolean;
  onFilterChange: (filter: CommentsFilter) => void;
  onSortChange: (sort: CommentsSort) => void;
  onClose: () => void;
};

export function CommentsSidebarHeader({
  filter,
  sort,
  stats,
  canComment,
  onFilterChange,
  onSortChange,
  onClose,
}: CommentsSidebarHeaderProps) {
  const countsByFilter: Record<CommentsFilter, number> = {
    open: stats.open,
    resolved: stats.resolved,
    all: stats.all,
  };

  const subtitle =
    stats.open > 0
      ? `${stats.open} open thread${stats.open === 1 ? '' : 's'} needing attention`
      : canComment && 'Select text in Editor to start a thread';

  return (
    <div className="nd-comments-sidebar__header">
      <div className="nd-comments-sidebar__top">
        <div className="nd-comments-sidebar__title-wrap">
          <h2 className="nd-comments-sidebar__title">Comments</h2>
          <p className="nd-comments-sidebar__subtitle">{subtitle}</p>
        </div>

        <div className="nd-comments-sidebar__top-actions">
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

          <button
            type="button"
            onClick={onClose}
            className="nd-comments-sidebar__close"
            aria-label="Close comments sidebar"
          >
            <Close size={14} />
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

      <p className="nd-comments-shortcut">Shortcut: Ctrl/Cmd + Alt + Shift + A</p>
    </div>
  );
}
