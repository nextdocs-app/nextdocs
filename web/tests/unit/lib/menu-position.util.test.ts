import {
  computeMenuPosition,
  MENU_ANCHOR_GAP_PX,
  MENU_VIEWPORT_MARGIN_PX,
  type MenuRect,
} from '../../../lib/menu-position.util';

const MENU = { width: 184, height: 46 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
// `min(86vw, 20rem)` drawer: 20rem wins from ~372px wide upwards, so a phone
// keeps a gutter of `viewportWidth - 320` (the drawer's rect includes its border,
// so its right edge is exactly 320).
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MOBILE_DRAWER_EDGE = 320;
const NARROW_MOBILE_VIEWPORT = { width: 320, height: 844 };
const NARROW_MOBILE_DRAWER_EDGE = 275;
// A phone drawer is min(86vw, 20rem), so only a tablet-width one leaves a gutter
// wide enough to hold the whole menu.
const ROOMY_MOBILE_VIEWPORT = { width: 760, height: 1024 };
const ROOMY_MOBILE_DRAWER_EDGE = 320;

const rect = (overrides: Partial<MenuRect> = {}): MenuRect => {
  const left = overrides.left ?? 220;
  const top = overrides.top ?? 300;
  const width = overrides.width ?? 24;
  const height = overrides.height ?? 24;

  return { left, top, width, height, right: left + width, bottom: top + height, ...overrides };
};

describe('computeMenuPosition', () => {
  it('centres the menu on the sidebar edge when straddling', () => {
    const position = computeMenuPosition({
      trigger: rect(),
      menu: MENU,
      viewport: DESKTOP_VIEWPORT,
      anchorEdgeX: 256,
      alignment: 'straddle',
    });

    // Half of the menu covers the rail, half the page next to it.
    expect(position.left).toBe(256 - MENU.width / 2);
    expect(position.left + MENU.width / 2).toBe(256);
  });

  it('opens below the trigger when the space below is large enough', () => {
    const position = computeMenuPosition({
      trigger: rect(),
      menu: MENU,
      viewport: DESKTOP_VIEWPORT,
      anchorEdgeX: 256,
      alignment: 'straddle',
    });

    expect(position.placement).toBe('below');
    expect(position.top).toBe(324 + MENU_ANCHOR_GAP_PX);
  });

  it('flips above the trigger when the row sits near the bottom edge', () => {
    const trigger = rect({ top: 720, bottom: 744 });
    const position = computeMenuPosition({
      trigger,
      menu: MENU,
      viewport: DESKTOP_VIEWPORT,
      anchorEdgeX: 256,
      alignment: 'straddle',
    });

    expect(position.placement).toBe('above');
    expect(position.top).toBe(720 - MENU_ANCHOR_GAP_PX - MENU.height);
    expect(position.top).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN_PX);
  });

  it('stays below and clamps when neither side fits (short viewport)', () => {
    const trigger = rect({ top: 40, bottom: 64 });
    const viewport = { width: 1280, height: 90 };
    const position = computeMenuPosition({
      trigger,
      menu: MENU,
      viewport,
      anchorEdgeX: 256,
      alignment: 'straddle',
    });

    expect(position.placement).toBe('below');
    expect(position.top).toBe(viewport.height - MENU.height - MENU_VIEWPORT_MARGIN_PX);
  });

  it('pulls the menu back inside the viewport when the page beside the rail is narrow', () => {
    const viewport = { width: 400, height: 800 };
    const position = computeMenuPosition({
      trigger: rect(),
      menu: MENU,
      viewport,
      anchorEdgeX: 380,
      alignment: 'straddle',
    });

    expect(position.left + MENU.width).toBe(viewport.width - MENU_VIEWPORT_MARGIN_PX);
  });

  it('starts the menu after the drawer edge when the gutter is wide enough', () => {
    const position = computeMenuPosition({
      trigger: rect({ left: 276, right: 300 }),
      menu: MENU,
      viewport: ROOMY_MOBILE_VIEWPORT,
      anchorEdgeX: ROOMY_MOBILE_DRAWER_EDGE,
      alignment: 'after-edge',
    });

    expect(position.left).toBe(ROOMY_MOBILE_DRAWER_EDGE + MENU_ANCHOR_GAP_PX);
    // Entirely beside the drawer, nothing overlapping it.
    expect(position.left).toBeGreaterThanOrEqual(ROOMY_MOBILE_DRAWER_EDGE);
  });

  it('uses the gutter right of a phone drawer without crossing the screen edge', () => {
    const position = computeMenuPosition({
      trigger: rect({ left: 278, right: 302 }),
      menu: MENU,
      viewport: MOBILE_VIEWPORT,
      anchorEdgeX: MOBILE_DRAWER_EDGE,
      alignment: 'after-edge',
    });

    // The gutter next to a 320px drawer on a 390px screen (70px) cannot hold a
    // menu, so the clamp wins: the menu sits flush with the right margin and
    // overlaps the drawer instead of running off screen.
    expect(position.left + MENU.width).toBe(MOBILE_VIEWPORT.width - MENU_VIEWPORT_MARGIN_PX);
    expect(position.left).toBeLessThan(MOBILE_DRAWER_EDGE);
  });

  it('clamps the menu inside the right margin on a narrow phone', () => {
    const trigger = rect({ left: 225, top: 300, right: 257, width: 32, height: 32, bottom: 332 });
    const position = computeMenuPosition({
      trigger,
      menu: MENU,
      viewport: NARROW_MOBILE_VIEWPORT,
      anchorEdgeX: NARROW_MOBILE_DRAWER_EDGE,
      alignment: 'after-edge',
    });

    expect(position.left).toBe(NARROW_MOBILE_VIEWPORT.width - MENU.width - MENU_VIEWPORT_MARGIN_PX);
    expect(position.left + MENU.width).toBe(NARROW_MOBILE_VIEWPORT.width - MENU_VIEWPORT_MARGIN_PX);
  });

  it('falls back to the trigger edge when the sidebar could not be measured', () => {
    const trigger = rect();

    expect(
      computeMenuPosition({
        trigger,
        menu: MENU,
        viewport: ROOMY_MOBILE_VIEWPORT,
        anchorEdgeX: null,
        alignment: 'after-edge',
      }).left
    ).toBe(trigger.right + MENU_ANCHOR_GAP_PX);

    expect(
      computeMenuPosition({
        trigger,
        menu: MENU,
        viewport: DESKTOP_VIEWPORT,
        anchorEdgeX: null,
        alignment: 'straddle',
      }).left
    ).toBe(trigger.right - MENU.width / 2);
  });

  it('never returns a negative offset for a menu wider than the viewport', () => {
    const position = computeMenuPosition({
      trigger: rect(),
      menu: MENU,
      viewport: { width: 150, height: 800 },
      anchorEdgeX: 100,
      alignment: 'after-edge',
    });

    expect(position.left).toBe(MENU_VIEWPORT_MARGIN_PX);
  });

  it('honours custom gap and margin options', () => {
    const position = computeMenuPosition({
      trigger: rect(),
      menu: MENU,
      viewport: DESKTOP_VIEWPORT,
      anchorEdgeX: 256,
      alignment: 'straddle',
      gap: 12,
      margin: 20,
    });

    expect(position.top).toBe(324 + 12);

    const clamped = computeMenuPosition({
      trigger: rect(),
      menu: MENU,
      viewport: { width: 400, height: 800 },
      anchorEdgeX: 380,
      alignment: 'straddle',
      margin: 20,
    });
    expect(clamped.left + MENU.width).toBe(400 - 20);
  });
});
