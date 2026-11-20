/**
 * The navigation rail's width is a per-device preference: it is not part of the
 * document, so it lives in `localStorage` and reaches the layout through the
 * `--nd-sidebar-width` custom property (the rail and the document toolbar both
 * read it).
 *
 * Reading it in React is too late — the shell has already painted at the CSS
 * default and an effect would then animate the rail out to the stored value.
 * `SIDEBAR_WIDTH_BOOTSTRAP_SCRIPT` is the head script that resolves it before
 * the first paint, so the server HTML's default, the rail and the toolbar all
 * agree from the first frame. The script and resize hook share these constants;
 * `theme.css` carries the matching CSS fallback for the pre-script/no-JS frame.
 */

export const SIDEBAR_WIDTH_STORAGE_KEY = 'nextdocs-sidebar-width';
export const SIDEBAR_WIDTH_CSS_VAR = '--nd-sidebar-width';

/** Matches the mobile drawer's `min(86vw, 20rem)` cap in layout-responsive.css. */
export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 256;
export const SIDEBAR_MAX_WIDTH = 480;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/** A stored width, clamped into range; `null` when missing or unusable. */
export function parseSidebarWidth(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : null;
}

/** The width currently in the layout, after the bootstrap script or a drag. */
export function readAppliedSidebarWidth(): number {
  if (typeof window === 'undefined') {
    return SIDEBAR_DEFAULT_WIDTH;
  }

  return (
    parseSidebarWidth(
      window.getComputedStyle(document.documentElement).getPropertyValue(SIDEBAR_WIDTH_CSS_VAR)
    ) ?? SIDEBAR_DEFAULT_WIDTH
  );
}

export function applySidebarWidth(width: number) {
  document.documentElement.style.setProperty(SIDEBAR_WIDTH_CSS_VAR, `${width}px`);
}

/**
 * Runs in `<head>` before the body paints. Deliberately ES5 and total: a syntax
 * error or a thrown storage access would leave the rail at the CSS default until
 * the first resize, which is the flash this exists to prevent.
 */
export const SIDEBAR_WIDTH_BOOTSTRAP_SCRIPT =
  `(function(){try{` +
  `var w=parseInt(localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_STORAGE_KEY)}),10);` +
  `if(isNaN(w)){w=${SIDEBAR_DEFAULT_WIDTH};}` +
  `if(w<${SIDEBAR_MIN_WIDTH}){w=${SIDEBAR_MIN_WIDTH};}` +
  `if(w>${SIDEBAR_MAX_WIDTH}){w=${SIDEBAR_MAX_WIDTH};}` +
  `document.documentElement.style.setProperty(${JSON.stringify(SIDEBAR_WIDTH_CSS_VAR)},w+'px');` +
  `}catch(e){}})();`;
