import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Document rows measure the pitch of the sticky stack. */
const DOC_ROW_SELECTOR = '[data-sidebar-row]';
/** Space rows are their own subtree base; they do not take the coarse-pointer padding. */
const SPACE_ROW_SELECTOR = '[data-sidebar-space-row]';

const SPACE_ROW_HEIGHT_VAR = '--nd-sticky-row-height';
const DOC_ROW_PITCH_VAR = '--nd-sticky-row-pitch';

/**
 * Sticky rows have to be pinned exactly one row apart, so every offset in the
 * stack is built from the rendered row geometry instead of constants. A row is
 * 33px tall on a mouse and 41px under `pointer-coarse`, the lists add a 1px
 * flex gap, and font size or zoom move both numbers. Hardcoding 32px per level
 * left each nested row a few pixels above its flush position, so a row slid
 * under the row above it for the last few pixels before it stuck.
 *
 * Measures the first rendered row of each kind and republishes the numbers as
 * CSS variables on the scroll container the trees live in.
 *
 * Returns a callback ref rather than taking a `RefObject`: the rail's first
 * client commit is a placeholder without a scroll container, so an effect keyed
 * on the ref object would run once against `null` and never measure the real
 * node that mounts immediately afterwards. A caller that also needs imperative
 * access to the node can pass its `RefObject`; it is kept in step by the
 * callback.
 */
export function useStickyRowMetrics<T extends HTMLElement = HTMLElement>(
  ref?: RefObject<T | null>
): (node: T | null) => void {
  const [container, setContainer] = useState<T | null>(null);
  const setContainerNode = useCallback(
    (node: T | null) => {
      if (ref) {
        ref.current = node;
      }
      setContainer(node);
    },
    [ref]
  );

  useEffect(() => {
    if (!container) return;

    let observedRow: Element | null = null;
    let frame = 0;

    const publish = (name: string, value: string) => {
      if (container.style.getPropertyValue(name) !== value) {
        container.style.setProperty(name, value);
      }
    };

    const measure = () => {
      const spaceRow = container.querySelector<HTMLElement>(SPACE_ROW_SELECTOR);
      const docRow = container.querySelector<HTMLElement>(DOC_ROW_SELECTOR);

      if (spaceRow) {
        const height = spaceRow.getBoundingClientRect().height;
        if (height > 0) publish(SPACE_ROW_HEIGHT_VAR, `${height}px`);
      }

      if (docRow) {
        const height = docRow.getBoundingClientRect().height;
        // The 1px flex gap between rows is part of the pitch. jsdom reports no
        // computed row-gap, so fall back to the inline one when it is unset.
        const parent = docRow.parentElement as HTMLElement | null;
        const gap =
          Number.parseFloat(parent ? getComputedStyle(parent).rowGap : '') ||
          Number.parseFloat(parent?.style.rowGap ?? '') ||
          0;
        if (height > 0) publish(DOC_ROW_PITCH_VAR, `${height + gap}px`);
      }

      return docRow;
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

    const track = (row: HTMLElement | null) => {
      if (!resizeObserver || !row || row === observedRow) return;
      if (observedRow) resizeObserver.unobserve(observedRow);
      resizeObserver.observe(row);
      observedRow = row;
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        track(measure());
      });
    };

    track(measure());

    // Rows arrive after the first paint (tree fetches, expansion) and the row
    // that was measured can be replaced when the tree re-renders.
    const mutations =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    mutations?.observe(container, { childList: true, subtree: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [container]);

  return setContainerNode;
}
