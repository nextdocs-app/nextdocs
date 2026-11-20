import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import {
  VersionHistoryToolbarActions,
  VersionSnapshotMenu,
} from '../../../components/editor/VersionHistoryRail';
import { addToast } from '../../../stores/toasts/toasts.slice';
import { useBlockNoteEditor, useComponentsContext, useStore } from '@blocknote/react';
import { useIsMobileLayout } from '../../../hooks/useMediaQuery.hook';

const mockDispatch = jest.fn();

jest.mock('../../../stores/hooks', () => ({
  useAppDispatch: () => mockDispatch,
}));

jest.mock('../../../hooks/useMediaQuery.hook', () => ({
  useIsMobileLayout: jest.fn(() => false),
}));

jest.mock('@blocknote/react', () => ({
  useBlockNoteEditor: jest.fn(),
  useComponentsContext: jest.fn(),
  useStore: jest.fn(),
}));

jest.mock('@blocknote/react/versioning', () => ({
  DefaultVersionMenuItems: () => <div data-testid="default-version-items" />,
}));

// The rail only needs the dropdown shell; BlockNote's menu renders into it.
const Dropdown = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <div data-testid="version-menu" className={className}>
    {children}
  </div>
);

const MENU_RECT = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 256,
  bottom: 24,
  width: 256,
  height: 24,
  toJSON: () => ({}),
} as DOMRect;

type VersioningState = {
  mode: string;
  showCurrentVersion?: boolean;
  pending?: { type: string; id: string };
  displayed?: { type: string; id: string };
  restoring?: boolean;
  history: { status: string; data?: Array<{ id: string }> };
};

function historyState(overrides: Partial<VersioningState> = {}): VersioningState {
  return {
    mode: 'versions',
    showCurrentVersion: false,
    displayed: { type: 'snapshot', id: '80-90' },
    restoring: false,
    history: { status: 'success', data: [{ id: '90-100' }] },
    ...overrides,
  };
}

function mockVersioning(
  options: {
    canRestore?: boolean;
    state?: VersioningState;
    restore?: jest.Mock;
  } = {}
) {
  const versioning = {
    canRestore: options.canRestore ?? true,
    restore: options.restore ?? jest.fn(async () => ({ status: 'done' })),
    store: {},
  };
  (useBlockNoteEditor as jest.Mock).mockReturnValue({
    getExtension: jest.fn((key: string) => (key === 'versioning' ? versioning : undefined)),
  });
  (useStore as jest.Mock).mockReturnValue(options.state ?? historyState());
  return versioning;
}

function renderSnapshotMenu({ trigger = true, rail = true } = {}) {
  const menu = (
    <div data-testid="positioner">
      <VersionSnapshotMenu />
    </div>
  );

  return render(
    rail ? (
      <div className="nd-version-history-rail" data-testid="rail">
        {trigger && (
          <button className="bn-snapshot-menu-trigger" aria-expanded="true">
            Snapshot actions
          </button>
        )}
        {menu}
      </div>
    ) : (
      menu
    )
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (useComponentsContext as jest.Mock).mockReturnValue({
    Generic: { Menu: { Dropdown } },
  });
  (useIsMobileLayout as jest.Mock).mockReturnValue(false);

  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(MENU_RECT);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 200,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 150,
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth;
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (useIsMobileLayout as jest.Mock).mockReturnValue(false);
});

describe('VersionSnapshotMenu', () => {
  it('renders nothing without the BlockNote component context', () => {
    (useComponentsContext as jest.Mock).mockReturnValue(undefined);

    const { container } = render(<VersionSnapshotMenu />);

    expect(container).toBeEmptyDOMElement();
  });

  it('pins the open row menu to the rail edge below its trigger', () => {
    renderSnapshotMenu();

    const positioner = screen.getByTestId('positioner');
    expect(positioner.dataset.ndVersionMenuPositioned).toBe('true');
    expect(positioner.style.getPropertyValue('--nd-version-menu-left')).toBe('156px');
    expect(positioner.style.getPropertyValue('--nd-version-menu-top')).toBe('30px');
    expect(screen.getByTestId('version-menu').style.visibility).toBe('');
    expect(screen.getByTestId('default-version-items')).toBeInTheDocument();
  });

  it('opens past the drawer edge on the mobile layout', () => {
    (useIsMobileLayout as jest.Mock).mockReturnValue(true);

    renderSnapshotMenu();

    // The drawer leaves a gutter narrower than the menu, so after-edge pins it
    // to the anchor plus the gap instead of straddling the rail.
    const positioner = screen.getByTestId('positioner');
    expect(positioner.style.getPropertyValue('--nd-version-menu-left')).toBe('262px');
  });

  it('leaves BlockNote placement in charge when there is no open trigger', () => {
    renderSnapshotMenu({ trigger: false });

    const positioner = screen.getByTestId('positioner');
    expect(positioner.dataset.ndVersionMenuPositioned).toBeUndefined();
    expect(positioner.style.getPropertyValue('--nd-version-menu-left')).toBe('');
    expect(screen.getByTestId('version-menu').style.visibility).toBe('');
  });

  it('does nothing when the menu is not inside the rail', () => {
    renderSnapshotMenu({ rail: false });

    const positioner = screen.getByTestId('positioner');
    expect(positioner.dataset.ndVersionMenuPositioned).toBeUndefined();
    expect(positioner.style.getPropertyValue('--nd-version-menu-left')).toBe('');
  });

  it('repositions on resize and releases its observer on unmount', () => {
    const observe = jest.fn();
    const disconnect = jest.fn();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = observe;
      disconnect = disconnect;
    };

    const { unmount } = renderSnapshotMenu();

    expect(observe).toHaveBeenCalledWith(screen.getByTestId('version-menu'));

    // A resize remeasures the menu and rewrites the pinned offsets.
    const positioner = screen.getByTestId('positioner');
    positioner.style.setProperty('--nd-version-menu-left', 'stale');
    window.dispatchEvent(new Event('resize'));
    expect(positioner.style.getPropertyValue('--nd-version-menu-left')).toBe('156px');

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('VersionHistoryToolbarActions', () => {
  it('always offers Close, even without a version controller', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    (useBlockNoteEditor as jest.Mock).mockReturnValue({
      getExtension: jest.fn(() => undefined),
    });

    render(<VersionHistoryToolbarActions onClose={onClose} />);

    expect(screen.queryByRole('button', { name: 'Restore version' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close version history' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides Restore for sessions that cannot roll the document back', () => {
    mockVersioning({ canRestore: false });

    render(<VersionHistoryToolbarActions onClose={jest.fn()} />);

    expect(screen.queryByRole('button', { name: 'Restore version' })).not.toBeInTheDocument();
  });

  it('closes the history view after a successful restore', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const versioning = mockVersioning();

    render(<VersionHistoryToolbarActions onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Restore version' }));

    expect(versioning.restore).toHaveBeenCalledWith('80-90');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('keeps the view open when the user cancels the restore', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    mockVersioning({ restore: jest.fn(async () => ({ status: 'cancelled' })) });

    render(<VersionHistoryToolbarActions onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Restore version' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('reports a failed restore without closing the view', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    mockVersioning({ restore: jest.fn(async () => ({ status: 'error' })) });

    render(<VersionHistoryToolbarActions onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Restore version' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      addToast({ type: 'error', message: 'Could not restore this version. Please try again.' })
    );
  });

  it('reports a rejected restore and logs it', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockVersioning({ restore: jest.fn(async () => Promise.reject(new Error('offline'))) });

    render(<VersionHistoryToolbarActions onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Restore version' }));

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Failed to restore document version:', expect.any(Error))
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      addToast({ type: 'error', message: 'Could not restore this version. Please try again.' })
    );
  });

  it('disables Restore while a history action is already pending', () => {
    mockVersioning({
      state: historyState({ pending: { type: 'snapshot', id: '90-100' } }),
    });

    render(<VersionHistoryToolbarActions onClose={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Restore version' })).toBeDisabled();
  });

  it('disables Restore while a restore is running', () => {
    mockVersioning({ state: historyState({ restoring: true }) });

    render(<VersionHistoryToolbarActions onClose={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Restore version' })).toBeDisabled();
  });
});
