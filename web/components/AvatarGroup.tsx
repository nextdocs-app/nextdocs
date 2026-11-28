'use client';

import { Children, isValidElement, type ReactNode } from 'react';

/**
 * How a stack splits between visible avatars and the overflow chip. The chip
 * takes one slot, so it only appears once the group is longer than `max`.
 */
export function getAvatarGroupCounts(
  total: number,
  max: number
): { overflow: number; visibleCount: number } {
  if (total <= max) {
    return { overflow: 0, visibleCount: total };
  }
  return { overflow: total - (max - 1), visibleCount: max - 1 };
}

export function AvatarGroup({
  children,
  max = 4,
  renderOverflow,
  className = '',
  ariaLabel,
}: {
  children: ReactNode;
  /** Maximum visible slots, including the overflow indicator. */
  max?: number;
  renderOverflow?: (overflow: number) => ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const items = Children.toArray(children);
  const { overflow, visibleCount } = getAvatarGroupCounts(items.length, max);

  return (
    <div
      className={`inline-flex items-center -space-x-1.5 ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      {items.slice(0, visibleCount).map((item, index) => (
        <span
          className="relative hover:!z-30 focus-within:!z-30 inline-flex items-center"
          style={{ zIndex: visibleCount - index }}
          // Children already carry identity (a user id); positional keys made a
          // re-sorted stack remount every avatar after the one that moved.
          key={isValidElement(item) && item.key !== null ? item.key : index}
        >
          {item}
        </span>
      ))}
      {overflow > 0 &&
        (renderOverflow?.(overflow) ?? (
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full ring-2 ring-background bg-muted px-1 text-[11px] font-medium text-muted-foreground">
            +{overflow}
          </span>
        ))}
    </div>
  );
}
