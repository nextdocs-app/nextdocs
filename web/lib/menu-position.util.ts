/**
 * Placement rules for floating menus anchored to a trigger inside the sidebar.
 *
 * The trigger sits in a panel that is flush against the viewport's left edge, so
 * the only useful directions are "over the panel edge" and "past it":
 *
 *   - `straddle` (desktop): the menu is centred on the sidebar's right edge, so
 *     half of it covers the rail and half the page beside it.
 *   - `after-edge` (mobile): the menu opens to the right of the drawer's edge.
 *     A phone drawer is `min(86vw, 20rem)` wide, leaving a gutter far narrower
 *     than any menu, so the clamp pulls the menu back until it no longer crosses
 *     the screen edge - which means it overlaps the drawer's right-hand stretch.
 *     Trimming the menu down to the gutter is the only way to avoid that overlap.
 *
 * Both axes are clamped into the viewport, and the vertical side flips when the
 * trigger sits too close to the bottom.
 *
 * Kept pure (no DOM access) so the placement is testable without a layout
 * engine.
 */

export interface MenuRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type MenuPlacement = 'above' | 'below';

/** How the menu uses the space next to the sidebar's right edge. */
export type MenuAlignment = 'straddle' | 'after-edge';

export interface MenuPosition {
  left: number;
  top: number;
  placement: MenuPlacement;
}

export interface MenuPositionInput {
  /** Trigger rect in viewport (client) coordinates. */
  trigger: MenuRect;
  /** Size the menu takes once rendered. */
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  /**
   * Right edge of the panel that owns the trigger. Falls back to the trigger's
   * own right edge when the panel could not be measured.
   */
  anchorEdgeX?: number | null;
  alignment: MenuAlignment;
  /** Vertical space kept between the trigger and the menu. */
  gap?: number;
  /** Minimum distance kept from every viewport edge. */
  margin?: number;
}

export const MENU_ANCHOR_GAP_PX = 6;
export const MENU_VIEWPORT_MARGIN_PX = 8;

function clamp(value: number, min: number, max: number): number {
  // A menu larger than the space between the margins inverts the range; pinning
  // to `min` still keeps its readable top-left corner on screen.
  return max < min ? min : Math.min(Math.max(value, min), max);
}

export function computeMenuPosition({
  trigger,
  menu,
  viewport,
  anchorEdgeX = null,
  alignment,
  gap = MENU_ANCHOR_GAP_PX,
  margin = MENU_VIEWPORT_MARGIN_PX,
}: MenuPositionInput): MenuPosition {
  const anchorX = anchorEdgeX ?? trigger.right;
  const preferredLeft = alignment === 'straddle' ? anchorX - menu.width / 2 : anchorX + gap;
  // Clamping is what keeps `after-edge` on screen: the drawer leaves a gutter
  // narrower than the menu, so the menu ends up flush with the right margin and
  // overlapping the drawer's edge instead of running off the screen.
  const left = clamp(preferredLeft, margin, viewport.width - menu.width - margin);

  const belowTop = trigger.bottom + gap;
  if (belowTop + menu.height + margin <= viewport.height) {
    return { left, top: belowTop, placement: 'below' };
  }

  const aboveTop = trigger.top - gap - menu.height;
  if (aboveTop >= margin) {
    return { left, top: aboveTop, placement: 'above' };
  }

  // Neither side fits (very short viewport): stay below and let the clamp hold
  // the menu inside the viewport instead of overlapping the trigger.
  return {
    left,
    top: clamp(belowTop, margin, viewport.height - menu.height - margin),
    placement: 'below',
  };
}
