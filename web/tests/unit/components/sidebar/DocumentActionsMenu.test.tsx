import { act, render, screen } from '@testing-library/react';
import { DocumentActionsMenu } from '../../../../components/sidebar/DocumentActionsMenu';
import type { DocActionsAnchor } from '../../../../components/sidebar/types';

const MENU_SIZE = { width: 184, height: 46 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
// `min(86vw, 20rem)` drawer: 20rem wins from ~372px wide upwards, so a phone
// keeps a gutter of `viewportWidth - 320`.
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MOBILE_DRAWER_EDGE = 320;
const NARROW_MOBILE_VIEWPORT = { width: 320, height: 844 };
const NARROW_MOBILE_DRAWER_EDGE = 275;
// Tablet-width mobile layout: the drawer stays 20rem, so the gutter beside it is
// wide enough to hold the whole menu.
const ROOMY_MOBILE_VIEWPORT = { width: 760, height: 1024 };
const VIEWPORT_MARGIN_PX = 8;

const rowTrigger = (overrides: Partial<DocActionsAnchor['trigger']> = {}) => ({
  left: 220,
  top: 300,
  right: 244,
  bottom: 324,
  width: 24,
  height: 24,
  ...overrides,
});

const anchor = (overrides: Partial<DocActionsAnchor> = {}): DocActionsAnchor => ({
  documentId: 'doc-1',
  actionType: 'move-to-trash',
  trigger: rowTrigger(),
  panelEdgeX: 256,
  ...overrides,
});

/**
 * The menu measures itself with `getBoundingClientRect`; jsdom reports zeros, so
 * the size it would have in a real browser is stubbed here.
 */
function stubLayout(viewport = DESKTOP_VIEWPORT, menuSize = MENU_SIZE) {
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: menuSize.width,
    bottom: menuSize.height,
    width: menuSize.width,
    height: menuSize.height,
    toJSON: () => ({}),
  } as DOMRect);

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: viewport.width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: viewport.height,
  });
}

function stubIsMobileLayout(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: isMobile && query === '(max-width: 767px)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

function renderMenu(props: Partial<React.ComponentProps<typeof DocumentActionsMenu>> = {}) {
  return render(
    <DocumentActionsMenu
      anchor={anchor()}
      resolvedTheme="light"
      onLeaveShared={jest.fn()}
      onMoveToTrash={jest.fn()}
      {...props}
    />
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DocumentActionsMenu', () => {
  it('straddles the sidebar edge and drops below the trigger on desktop', () => {
    stubLayout();
    stubIsMobileLayout(false);

    renderMenu();

    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('164px');
    expect(menu.style.top).toBe('330px');
    expect(menu).toHaveAttribute('data-placement', 'below');
    // Half of the menu covers the rail, the other half hangs over the page.
    expect(parseFloat(menu.style.left) + MENU_SIZE.width / 2).toBe(256);
    expect(menu.style.visibility).toBe('');
  });

  it('opens above the trigger when the row is close to the bottom edge', () => {
    stubLayout();
    stubIsMobileLayout(false);

    renderMenu({ anchor: anchor({ trigger: rowTrigger({ top: 720, bottom: 744 }) }) });

    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('data-placement')).toBe('above');
    expect(menu.style.top).toBe('668px');
  });

  it('opens to the right of the drawer and stays on screen on mobile', () => {
    stubLayout(MOBILE_VIEWPORT);
    stubIsMobileLayout(true);

    // A 320px drawer leaves a 70px gutter on a 390px screen - narrower than the
    // menu - so the clamp wins: the menu takes all of that gutter, ends flush
    // with the right margin and overlaps the drawer's edge.
    renderMenu({
      anchor: anchor({
        trigger: rowTrigger({ left: 278, right: 302 }),
        panelEdgeX: MOBILE_DRAWER_EDGE,
      }),
    });

    const menu = screen.getByRole('menu');
    expect(parseFloat(menu.style.left) + MENU_SIZE.width).toBe(
      MOBILE_VIEWPORT.width - VIEWPORT_MARGIN_PX
    );
    expect(parseFloat(menu.style.left)).toBeLessThan(MOBILE_DRAWER_EDGE);
  });

  it('takes the space right of a drawer whose gutter fits the menu', () => {
    stubLayout(ROOMY_MOBILE_VIEWPORT);
    stubIsMobileLayout(true);

    renderMenu({
      anchor: anchor({ trigger: rowTrigger({ left: 276, right: 300 }), panelEdgeX: 320 }),
    });

    const menu = screen.getByRole('menu');
    // Starts just past the drawer edge, so nothing sits over the tree.
    expect(menu.style.left).toBe('326px');
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(320);
  });

  it('clamps the menu inside the right margin on a narrow phone', () => {
    stubLayout(NARROW_MOBILE_VIEWPORT);
    stubIsMobileLayout(true);

    renderMenu({
      anchor: anchor({
        trigger: rowTrigger({ left: 225, right: 257, width: 32, height: 32, bottom: 332 }),
        panelEdgeX: NARROW_MOBILE_DRAWER_EDGE,
      }),
    });

    const menu = screen.getByRole('menu');
    expect(parseFloat(menu.style.left)).toBe(
      NARROW_MOBILE_VIEWPORT.width - MENU_SIZE.width - VIEWPORT_MARGIN_PX
    );
    expect(parseFloat(menu.style.left) + MENU_SIZE.width).toBe(
      NARROW_MOBILE_VIEWPORT.width - VIEWPORT_MARGIN_PX
    );
  });

  it('recalculates position on window resize', () => {
    stubLayout(DESKTOP_VIEWPORT);
    stubIsMobileLayout(false);

    renderMenu({ anchor: anchor({ trigger: rowTrigger({ top: 600, bottom: 624 }) }) });

    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('data-placement')).toBe('below');
    expect(menu.style.top).toBe('630px');

    // Viewport height shrinks, forcing it to flip above
    act(() => {
      window.innerHeight = 650;
      window.dispatchEvent(new Event('resize'));
    });

    expect(menu.getAttribute('data-placement')).toBe('above');
    expect(menu.style.top).toBe('548px');
  });
});
