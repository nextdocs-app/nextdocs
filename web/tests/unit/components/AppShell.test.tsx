import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../../../components/AppShell';
import { useAuth } from '../../../hooks/useAuth.hook';
import { usePendingCloudDocumentCreates } from '../../../hooks/usePendingCloudDocumentCreates.hook';
import { PENDING_DOCUMENT_DISCARDED_EVENT } from '../../../lib/pending-cloud-create.util';
import { setCollapsed, toggleMobileNav } from '../../../stores/sidebar/sidebar.slice';
import { addToast } from '../../../stores/toasts/toasts.slice';

let mockIsMobileLayout = false;
const mockSidebarState = { isMobileNavOpen: false, isCollapsed: false };

jest.mock('../../../components/sidebar', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/ToastContainer', () => ({ ToastContainer: () => null }));
jest.mock('../../../components/WorkspaceEntry', () => ({
  WorkspaceEntry: () => <div>workspace-entry</div>,
}));
jest.mock('../../../hooks/useMediaQuery.hook', () => ({
  useIsMobileLayout: () => mockIsMobileLayout,
}));
jest.mock('../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../hooks/usePendingCloudDocumentCreates.hook', () => ({
  usePendingCloudDocumentCreates: jest.fn(),
}));
const mockDispatch = jest.fn();
jest.mock('../../../stores/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: { sidebar: typeof mockSidebarState }) => unknown) =>
    selector({ sidebar: mockSidebarState }),
}));

const mockReplace = jest.fn();
let mockPathname = '/doc/doc-1';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

function announceDiscard(announce: boolean, id = 'doc-1') {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(PENDING_DOCUMENT_DISCARDED_EVENT, { detail: { id, announce } })
    );
  });
}

describe('AppShell', () => {
  beforeEach(() => {
    mockPathname = '/doc/doc-1';
    mockReplace.mockClear();
    mockIsMobileLayout = false;
    mockSidebarState.isMobileNavOpen = false;
    mockSidebarState.isCollapsed = false;
  });

  it('wires the offline create replay to the signed-in session', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(usePendingCloudDocumentCreates).toHaveBeenCalledWith('user-1', 'token-1');
  });

  it('says why a page the user wrote disappeared', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });
    mockDispatch.mockClear();

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    announceDiscard(false);
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: addToast.type }));

    announceDiscard(true);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: addToast.type,
        payload: expect.objectContaining({ type: 'error' }),
      })
    );
  });

  it('leaves the page whose local copy was discarded', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    announceDiscard(true, 'another-doc');
    expect(mockReplace).not.toHaveBeenCalled();

    announceDiscard(true);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('uses the workspace entry instead of the shell for a guest on the home route', () => {
    mockPathname = '/';
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      accessToken: null,
      isTokenExpiringSoon: false,
      isInitializing: false,
      isAuthenticated: false,
    });

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(screen.getByText('workspace-entry')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('holds the workspace entry while a persisted session is still refreshing', () => {
    mockPathname = '/';
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
      isInitializing: true,
      isAuthenticated: true,
    });

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(screen.getByText('workspace-entry')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders the shell for a signed-in user on the home route', () => {
    mockPathname = '/';
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
      isInitializing: false,
      isAuthenticated: true,
    });

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByText('workspace-entry')).not.toBeInTheDocument();
  });

  it('keeps a way back into a collapsed rail on screens without a document toolbar', async () => {
    const user = userEvent.setup();
    mockSidebarState.isCollapsed = true;
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });
    mockDispatch.mockClear();

    render(
      <AppShell>
        <div>error screen</div>
      </AppShell>
    );

    await user.click(screen.getByRole('button', { name: 'Open sidebar' }));

    expect(mockDispatch).toHaveBeenCalledWith(setCollapsed(false));
  });

  it('opens the mobile drawer from the shell', async () => {
    const user = userEvent.setup();
    mockIsMobileLayout = true;
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });
    mockDispatch.mockClear();

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(mockDispatch).toHaveBeenCalledWith(toggleMobileNav());
  });

  it('does not render a desktop sidebar opener while the rail is open', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(screen.queryByRole('button', { name: 'Open sidebar' })).not.toBeInTheDocument();
  });
});
