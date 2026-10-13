'use client';

import { memo } from 'react';
import { PageIcon } from '@/components/page/PageIcon';
import type { IconColorId } from '@/lib/document-icon.util';
import type { DocumentIcon } from '@/types/document.types';

/**
 * One glyph in the picker grid.
 *
 * Memoized and fed primitives rather than rendered inline: the panel re-renders
 * on every keystroke in the search field and on every revealed page, and the
 * grid grows to the whole catalog — without the memo each of those re-rendered
 * every glyph already on screen (each one carrying a data-URL mask), which is
 * what made typing and scrolling through the picker feel sticky.
 */
export const IconGridButton = memo(function IconGridButton({
  name,
  svg,
  color,
  onPick,
}: {
  name: string;
  /** Pre-fetched glyph text; omitted glyphs fall back to their own URL. */
  svg?: string | null;
  color: IconColorId;
  onPick: (icon: DocumentIcon) => void;
}) {
  // Catalog slugs are kebab-case; the spaces read better to a screen reader.
  const label = name.replace(/-/g, ' ');
  const icon: DocumentIcon = {
    type: 'builtin',
    value: name,
    color: color === 'default' ? undefined : color,
  };

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onPick(icon)}
      className="flex h-9 w-full min-w-0 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground cursor-pointer"
    >
      <PageIcon icon={icon} size={17} svg={svg} />
    </button>
  );
});
