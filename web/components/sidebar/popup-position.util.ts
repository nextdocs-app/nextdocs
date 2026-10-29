import type { CSSProperties } from 'react';

/** Space between a trigger and the menu it opens. */
const POPUP_OFFSET_PX = 6;

/**
 * The account trigger sits inside the footer's padding, with the footer's
 * horizontal rule just above it. A menu opening upward clears that rule only if
 * it skips the padding too, plus the same gap the downward menus use.
 */
const POPUP_ABOVE_OFFSET_PX = 12;

/**
 * Fixed-position style that hangs a menu off its trigger.
 *
 * Menus render at the rail root because the document tree scrolls and would
 * clip them, so they cannot inherit the trigger's position. Measure the trigger
 * instead: each menu is exactly as wide as the button that opened it, and stays
 * flush when the rail is resized.
 */
export function resolvePopupPosition(
  trigger: HTMLElement | null,
  placement: 'above' | 'below'
): CSSProperties | null {
  if (!trigger) {
    return null;
  }

  const rect = trigger.getBoundingClientRect();
  // No layout yet (tests, first paint): leave the menu content-sized rather
  // than collapsing it to zero width.
  const width = rect.width > 0 ? rect.width : undefined;

  if (placement === 'below') {
    return { left: rect.left, top: rect.bottom + POPUP_OFFSET_PX, width };
  }

  return { left: rect.left, bottom: window.innerHeight - rect.top + POPUP_ABOVE_OFFSET_PX, width };
}
