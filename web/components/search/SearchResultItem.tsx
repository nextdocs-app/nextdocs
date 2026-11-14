import { useMemo } from 'react';
import { DocumentGlyph } from '@/components/page/DocumentGlyph';
import { Layers } from '@/icons';
import { formatRelativeSearchTime } from '@/lib/search-helpers.util';
import type { SearchHit } from '@/types/search.types';
import { HighlightedSegments } from './HighlightedSegments';

export interface SearchResultItemProps {
  id: string;
  hit: SearchHit;
  isActive: boolean;
  /**
   * Adds the Private location for the caller's own root documents. Never
   * inferred from a missing path: a document shared with the caller has no
   * breadcrumb when its ancestors are unreadable, and it is not private.
   */
  showPrivate: boolean;
  onSelect: (hit: SearchHit, openInNewTab: boolean) => void;
  onHover: () => void;
}

export function SearchResultItem({
  id,
  hit,
  isActive,
  showPrivate,
  onSelect,
  onHover,
}: SearchResultItemProps) {
  const relativeTime = useMemo(() => formatRelativeSearchTime(hit.updatedAt), [hit.updatedAt]);

  const hasPath = Boolean(hit.space) || hit.breadcrumb.length > 0;
  const locationLabel = !hasPath && showPrivate ? 'Private' : null;

  // The input keeps focus and drives the listbox through aria-activedescendant,
  // so an option must not be a focusable control of its own: activation comes
  // from the input's Enter key or from a pointer click on the option itself.
  return (
    <li
      id={id}
      role="option"
      aria-selected={isActive}
      onMouseEnter={onHover}
      onClick={(event) => onSelect(hit, event.metaKey || event.ctrlKey)}
      className="cursor-pointer px-2.5"
    >
      <div
        className={`flex w-full items-start gap-3.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-100 ${
          isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/60'
        }`}
      >
        <DocumentGlyph icon={hit.icon} className="mt-0.5" />

        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium leading-snug">
              <HighlightedSegments segments={hit.title} fallback="Untitled" />
            </span>

            {relativeTime && (
              <span className="hidden flex-shrink-0 text-[12px] tabular-nums text-muted-foreground sm:inline">
                {relativeTime}
              </span>
            )}
          </span>

          {(hasPath || locationLabel) && (
            <span className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
              {hit.space && (
                <span className="inline-flex min-w-0 max-w-[11rem] items-center gap-1 truncate font-medium text-muted-foreground">
                  <Layers size={12} className="flex-shrink-0 opacity-75" />
                  <span className="truncate">{hit.space.name}</span>
                </span>
              )}
              {hit.space && hit.breadcrumb.length > 0 && (
                <span aria-hidden="true" className="flex-shrink-0 opacity-55">
                  /
                </span>
              )}
              {hit.breadcrumb.length > 0 && (
                <span className="truncate">
                  {hit.breadcrumb.map((crumb) => crumb.title || 'Untitled').join(' / ')}
                </span>
              )}
              {locationLabel && <span>{locationLabel}</span>}
            </span>
          )}

          {hit.snippet.length > 0 && (
            <span className="mt-1.5 block line-clamp-2 text-[13px] leading-[1.5] text-muted-foreground">
              <HighlightedSegments segments={hit.snippet} />
            </span>
          )}
        </span>
      </div>
    </li>
  );
}
