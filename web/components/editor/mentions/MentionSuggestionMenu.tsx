'use client';

import { Fragment, useEffect, useRef } from 'react';
import type { SuggestionMenuProps } from '@blocknote/react';
import { components as shadcnComponents } from '@blocknote/shadcn';
import type { MentionSuggestionItem } from './mention-menu';

/**
 * The `@` menu list, drawn as the share popover's person rows.
 *
 * BlockNote's stock suggestion menu renders a one-line title with an optional subtext.
 * The picker instead shows the same two-line row the share panel uses — avatar, name,
 * email — so the people list reads identically wherever it appears. Only the list is
 * replaced: `SuggestionMenuController` still owns the popover, filtering, keyboard
 * navigation and item ids, and the group header ("People") is drawn exactly where the
 * stock menu draws it.
 *
 * Rows are keyed by user id rather than by position, so typing does not remount the
 * avatar of a candidate that stayed in the result set. The `id` stays index-based
 * because that is the id the controller points `aria-activedescendant` at.
 */
export function MentionSuggestionMenu({
  items,
  loadingState,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<MentionSuggestionItem>) {
  const empty = items.length === 0 && loadingState !== 'loading-initial';
  const selectedRow = useRef<HTMLDivElement | null>(null);

  // Keyboard navigation must keep the selected row visible, but scrolling a row that is
  // already visible would jump the list under the reader's eyes. `block: 'nearest'`
  // scrolls only the overflow it has to, and jsdom exposes no `scrollIntoView`.
  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <shadcnComponents.SuggestionMenu.Root
      id="bn-suggestion-menu"
      className="bn-suggestion-menu w-80 max-w-[calc(100vw-2rem)]"
    >
      {items.map((item, index) => (
        <Fragment key={item.userId}>
          {item.group && item.group !== items[index - 1]?.group && (
            <shadcnComponents.SuggestionMenu.Label className="bn-suggestion-menu-label">
              {item.group}
            </shadcnComponents.SuggestionMenu.Label>
          )}
          <div
            ref={index === selectedIndex ? selectedRow : undefined}
            id={`bn-suggestion-menu-item-${index}`}
            role="option"
            aria-selected={index === selectedIndex || undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onItemClick?.(item)}
            className="flex items-center gap-2.5 rounded-lg py-1 px-1.5 cursor-default select-none transition-colors hover:bg-sidebar-accent/40 aria-selected:bg-sidebar-accent/40"
          >
            {item.icon}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[13px] font-medium text-card-foreground truncate leading-snug min-w-0 shrink">
                  {item.title}
                </span>
              </div>
              {item.subtext && (
                <p className="text-[11.5px] text-muted-foreground/70 truncate leading-snug mt-0.5">
                  {item.subtext}
                </p>
              )}
            </div>
          </div>
        </Fragment>
      ))}
      {empty && (
        <shadcnComponents.SuggestionMenu.EmptyItem>
          No people found
        </shadcnComponents.SuggestionMenu.EmptyItem>
      )}
    </shadcnComponents.SuggestionMenu.Root>
  );
}
