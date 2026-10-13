'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IconCatalogCategory } from './useIconCatalog.hook';
import { useLoadMoreOnScroll } from './useLoadMoreOnScroll.hook';

export interface IconSection {
  id: string;
  label: string;
  icons: string[];
}

/**
 * Search + scroll reveal for the builtin icon grid.
 *
 * Extracted from `IconPickerPanel` so the panel composes search state rather
 * than owning it: filtering is a pure memo and the visible budget resets on
 * query/category change. The hook owns the sentinel it returns, so callers only
 * place one element — the observer plumbing (including the late-mount and
 * re-arm cases) lives in `useLoadMoreOnScroll`.
 *
 * When `categories` is present the grid renders sectioned: matches keep
 * catalog order across sections, the visible budget slices that flattened
 * order, and `sections` regroups the slice so headers only render for
 * sections with visible icons. Without categories the hook behaves exactly
 * as before, over the flat `names` list.
 */
export function useIconSearchPagination({
  names,
  categories,
  query,
  resetKey,
  pageSize,
  scrollContainerRef,
  enabled,
}: {
  names: string[];
  categories?: IconCatalogCategory[];
  query: string;
  resetKey: string;
  pageSize: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [prevReset, setPrevReset] = useState({ query, resetKey });
  // Reset pagination when the query or tab changes. Adjusted during render
  // (not in an effect) so the reset commits with the same render instead of
  // cascading a second one.
  if (prevReset.query !== query || prevReset.resetKey !== resetKey) {
    setPrevReset({ query, resetKey });
    setVisibleCount(pageSize);
  }

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [query, resetKey, scrollContainerRef]);

  // Query-filtered sections in catalog order, or null when the caller has
  // no categories and the hook runs over the flat names list instead.
  const filteredSections = useMemo<IconCatalogCategory[] | null>(() => {
    if (!categories || categories.length === 0) {
      return null;
    }
    const normalized = query.trim().toLowerCase();
    return categories
      .map((category) => ({
        ...category,
        icons: normalized
          ? category.icons.filter((name) => name.toLowerCase().includes(normalized))
          : [...category.icons],
      }))
      .filter((category) => category.icons.length > 0);
  }, [categories, query]);

  const matches = useMemo(() => {
    if (filteredSections) {
      return filteredSections.flatMap((section) => section.icons);
    }
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return names;
    }
    return names.filter((name) => name.toLowerCase().includes(normalized));
  }, [names, query, filteredSections]);

  const displayed = useMemo(() => matches.slice(0, visibleCount), [matches, visibleCount]);
  const hasMore = visibleCount < matches.length;

  // The visible slice regrouped, so the panel renders a header only for a
  // section that actually shows icons. Slicing per section (rather than
  // regrouping the flat slice through a set) keeps this identical to
  // `displayed` by construction instead of by a second filtering pass.
  const sections = useMemo<IconSection[]>(() => {
    if (!filteredSections) {
      return [];
    }
    const visible: IconSection[] = [];
    let budget = visibleCount;
    for (const section of filteredSections) {
      if (budget <= 0) {
        break;
      }
      const icons = section.icons.slice(0, budget);
      budget -= icons.length;
      visible.push({ id: section.id, label: section.label, icons });
    }
    return visible;
  }, [filteredSections, visibleCount]);

  // Clamped to the match count so a stale budget (a query that shrank the list
  // between reveals) can never overshoot; the reveal loop then just stops.
  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + pageSize, matches.length));
  }, [pageSize, matches.length]);

  const { sentinelRef, isSupported: isSentinelSupported } = useLoadMoreOnScroll({
    rootRef: scrollContainerRef,
    enabled: enabled && hasMore,
    revision: visibleCount,
    onReachEnd: loadMore,
  });

  return {
    matches,
    displayed,
    hasMore,
    sections,
    /** Attach past the last item; absent when the environment cannot observe. */
    sentinelRef,
    isSentinelSupported,
    loadMore,
  };
}
