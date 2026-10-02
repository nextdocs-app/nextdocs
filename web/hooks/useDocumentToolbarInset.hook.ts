'use client';

import { useEffect, useState } from 'react';
import { DOC_TOOLBAR_INSET_CSS_VAR } from '@/lib/viewport-bounds.util';

/**
 * The document toolbar's `fixed` strips (see `DocToolbar.tsx`): the breadcrumbs
 * on the left and the controls on the right, both pinned to the top of the
 * viewport and floating over the editor.
 */
export const DOCUMENT_TOOLBAR_SELECTOR = '.nd-doc-toolbar, .nd-doc-toolbar-left';

/** Air kept between the toolbar and anything that has to clear it. */
export const DOCUMENT_TOOLBAR_GAP_PX = 8;

/**
 * `top-2` plus the taller single row (`h-9`, which is what the toolbar buttons
 * are below `md`), plus the gap. Used until the toolbar has been measured, so
 * that a first paint can never land under it.
 */
export const DOCUMENT_TOOLBAR_INSET_FALLBACK_PX = 44;

/**
 * Where the usable part of the viewport starts for floating UI that must not
 * reach the document toolbar: the toolbar's lowest edge plus the gap.
 *
 * The two strips can disagree on height — the left one is taller below `md`, and
 * the right one grows a row when a notice (offline, trashed document) wraps — so
 * the bottom-most edge of all of them is what counts.
 *
 * Pure, so the measurement can be tested without a layout engine.
 */
export function measureDocumentToolbarInset(root: ParentNode): number {
  let bottom = 0;

  for (const element of root.querySelectorAll(DOCUMENT_TOOLBAR_SELECTOR)) {
    bottom = Math.max(bottom, element.getBoundingClientRect().bottom);
  }

  // No toolbar in the tree (or one that is not laid out at all, as in jsdom).
  if (bottom <= 0) {
    return DOCUMENT_TOOLBAR_INSET_FALLBACK_PX;
  }

  return Math.round(bottom) + DOCUMENT_TOOLBAR_GAP_PX;
}

/**
 * Tracks the toolbar inset for the current layout.
 *
 * It is not a constant: the `md` breakpoint swaps the toolbar rows for shorter
 * ones, and a notice wraps the right-hand toolbar onto a second row. Observing
 * the strips themselves reports both, and the inset only ever feeds floating UI,
 * so it is applied after paint rather than blocking it.
 *
 * The inset is also published as `DOC_TOOLBAR_INSET_CSS_VAR` on the document
 * element for CSS-positioned popups that no JS middleware reaches: Base UI's
 * `Positioner` (block-type select, colour menu) sizes its popups from
 * `--available-height`, and `styles/globals.css` subtracts the toolbar strip
 * from it so upward-opening popups stop below the toolbar. Removed on unmount
 * so a stale measurement never caps popups on a page without a toolbar.
 */
export function useDocumentToolbarInset(): number {
  const [inset, setInset] = useState(DOCUMENT_TOOLBAR_INSET_FALLBACK_PX);

  useEffect(() => {
    const publish = (value: number) =>
      document.documentElement.style.setProperty(DOC_TOOLBAR_INSET_CSS_VAR, `${value}px`);

    const measure = () => {
      const next = measureDocumentToolbarInset(document);
      setInset(next);
      publish(next);
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);

    const observedElements = new Set<Element>();

    const syncObservedElements = () => {
      const currentElements = new Set(document.querySelectorAll(DOCUMENT_TOOLBAR_SELECTOR));

      for (const el of observedElements) {
        if (!currentElements.has(el)) {
          resizeObserver?.unobserve(el);
          observedElements.delete(el);
        }
      }

      for (const el of currentElements) {
        if (!observedElements.has(el)) {
          resizeObserver?.observe(el);
          observedElements.add(el);
        }
      }

      measure();
    };

    syncObservedElements();

    const handleMutations = (mutations: MutationRecord[]) => {
      let isRelevant = false;
      for (const mutation of mutations) {
        const target = mutation.target as HTMLElement | null;
        if (
          target &&
          target.nodeType === Node.ELEMENT_NODE &&
          target.closest?.(DOCUMENT_TOOLBAR_SELECTOR)
        ) {
          isRelevant = true;
          break;
        }
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (
            node instanceof HTMLElement &&
            (node.matches?.(DOCUMENT_TOOLBAR_SELECTOR) ||
              node.querySelector?.(DOCUMENT_TOOLBAR_SELECTOR))
          ) {
            isRelevant = true;
            break;
          }
        }
        if (isRelevant) break;
        for (let i = 0; i < mutation.removedNodes.length; i++) {
          const node = mutation.removedNodes[i];
          if (
            node instanceof HTMLElement &&
            (node.matches?.(DOCUMENT_TOOLBAR_SELECTOR) ||
              node.querySelector?.(DOCUMENT_TOOLBAR_SELECTOR))
          ) {
            isRelevant = true;
            break;
          }
        }
        if (isRelevant) break;
      }

      if (isRelevant) {
        syncObservedElements();
      }
    };

    const mutationObserver =
      typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(handleMutations);

    if (document.body && mutationObserver) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    // The toolbar's own box does not change when the safe-area insets or the
    // viewport height do, and floating UI is laid out against those.
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty(DOC_TOOLBAR_INSET_CSS_VAR);
    };
  }, []);

  return inset;
}
