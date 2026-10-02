/**
 * Shared bounds for floating UI that must stay clear of the document toolbar.
 *
 * The document toolbar (`DocToolbar.tsx`) is pinned to the top of the viewport
 * and floats *over* the editor instead of pushing it down, so anything that
 * positions itself against the viewport — BlockNote's floating comment thread
 * (floating-ui middleware, see `comment.utils.ts`) and the formatting toolbar's
 * Base UI popups (block-type select, colour menu, positioned by Base UI's
 * `Positioner` and capped in `styles/globals.css`) — has to treat "the
 * viewport minus the toolbar" as its usable area. Both consumers read from
 * here so the inset, the margins, and the CSS variable name stay in sync:
 *
 *   - JS-positioned popups (floating-ui) take the padding object from
 *     `createViewportBounds(toolbarInset)`.
 *   - CSS-positioned popups (Base UI) read the measured inset from
 *     `DOC_TOOLBAR_INSET_CSS_VAR`, published on `document.documentElement` by
 *     `useDocumentToolbarInset` (see `hooks/useDocumentToolbarInset.hook.ts`).
 *
 * Kept pure (no DOM access) so the bounds are testable without a layout
 * engine.
 */

export interface ViewportBounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Distance kept from the viewport's side and bottom edges. */
export const FLOATING_VIEWPORT_MARGIN_PX = 12;

/**
 * Custom property carrying the measured toolbar inset (toolbar's lowest edge
 * plus the gap) for CSS-positioned popups. The `44px` fallback used in
 * `styles/globals.css` mirrors `DOCUMENT_TOOLBAR_INSET_FALLBACK_PX`.
 */
export const DOC_TOOLBAR_INSET_CSS_VAR = '--nd-doc-toolbar-inset';

/**
 * Where floating UI may sit: the viewport minus the toolbar strip on top and
 * the margin everywhere else.
 *
 * `toolbarInset` is measured (see `useDocumentToolbarInset`): the toolbar's
 * height changes with the breakpoint and with a wrapped notice row, so the
 * top bound moves with it.
 */
export function createViewportBounds(toolbarInset: number): ViewportBounds {
  return {
    top: toolbarInset,
    right: FLOATING_VIEWPORT_MARGIN_PX,
    bottom: FLOATING_VIEWPORT_MARGIN_PX,
    left: FLOATING_VIEWPORT_MARGIN_PX,
  };
}
