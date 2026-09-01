import { ChevronRight, MoreHorizontal } from '@/icons';
import { SIDEBAR_VISIBLE_COUNT } from './types';

export interface SidebarSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  /** Optional trailing action rendered at the right edge of the header (e.g. "new document" button). */
  rightAction?: React.ReactNode;
  /** Whether the section's root documents are still loading (shows skeleton rows). */
  isLoading: boolean;
  /** Number of root documents currently rendered in the section. */
  rootCount: number;
  /** Whether more root documents exist beyond the visible slice (filtered). */
  hasMore?: boolean;
  /** Text shown when the section has no root documents. */
  emptyText: string;
  /** Unique prefix for skeleton row keys. */
  skeletonKeyPrefix: string;
  /** Accessible name for the "Show More" row. */
  showAllAriaLabel: string;
  /** Called when "Show More" is clicked (opens the section's full documents panel). */
  onShowAll: () => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * Shared shell for a sidebar section (Private / Shared). Owns all the section
 * chrome — header, skeleton rows, empty state and the "Show More" row — so any
 * modification (markup, threshold, labels) is reflected on every section at once.
 * "Show More" is shown only when the section's root document count exceeds
 * SIDEBAR_VISIBLE_COUNT and simply opens the section's full documents panel.
 */
export function SidebarSection({
  title,
  isOpen,
  onToggle,
  rightAction,
  isLoading,
  rootCount,
  hasMore,
  emptyText,
  skeletonKeyPrefix,
  showAllAriaLabel,
  onShowAll,
  className,
  children,
}: SidebarSectionProps) {
  const isEmpty = rootCount === 0;
  const showMore = !isLoading && (rootCount > SIDEBAR_VISIBLE_COUNT || Boolean(hasMore));

  return (
    <div className={`group flex flex-col ${className ?? ''}`.trim()}>
      {/* Full-width clickable header; the chevron is purely decorative */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="group/header flex items-center justify-between mx-1.5 pl-2 pr-2 py-[5px] text-[13px] text-muted-foreground rounded-sm hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer select-none"
      >
        <span className="flex items-center gap-1 min-w-0">
          <span className="font-medium text-muted-foreground/80 group-hover/header:text-muted-foreground transition-colors duration-100">
            {title}
          </span>
          <ChevronRight
            size={14}
            className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150 ${
              isOpen ? 'rotate-90' : 'rotate-0'
            }`}
          />
        </span>
        {rightAction}
      </div>

      {isOpen && (
        <nav className="px-1.5 pt-px pb-2">
          {isLoading && isEmpty ? (
            <div className="flex flex-col gap-1 px-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={`${skeletonKeyPrefix}-${i}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm"
                >
                  <div className="h-4 w-4 flex-shrink-0 rounded-sm bg-sidebar-foreground/10 animate-pulse" />
                  <div
                    className={`h-3 rounded-sm bg-sidebar-foreground/10 animate-pulse ${
                      i === 1 ? 'w-[70%]' : i === 2 ? 'w-[55%]' : 'w-[65%]'
                    }`}
                  />
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <div className="px-2 pt-1">
              <p className="text-[13px] text-muted-foreground/50">{emptyText}</p>
            </div>
          ) : (
            children
          )}

          {showMore && (
            <ul className="flex flex-col gap-px mt-0.5">
              <li>
                <button
                  type="button"
                  onClick={onShowAll}
                  aria-label={showAllAriaLabel}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left transition-colors duration-100 cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
                >
                  <MoreHorizontal className="flex-shrink-0" />
                  <span className="text-[13px] truncate">Show More</span>
                </button>
              </li>
            </ul>
          )}
        </nav>
      )}
    </div>
  );
}
