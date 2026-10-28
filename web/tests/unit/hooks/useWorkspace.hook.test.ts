import { act, renderHook, waitFor } from '@testing-library/react';
import { useWorkspace } from '../../../hooks/useWorkspace.hook';
import { useAuth } from '../../../hooks/useAuth.hook';
import { dispatchWorkspaceUpdated } from '../../../lib/workspace-event.util';
import { workspaceApiService } from '../../../services/workspace.service';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../services/workspace.service', () => ({
  workspaceApiService: {
    getCurrent: jest.fn(),
  },
}));

const workspace = {
  id: 'workspace-1',
  name: 'Acme',
  icon: null,
  role: 'OWNER' as const,
  memberCount: 3,
};

const mockGetCurrent = workspaceApiService.getCurrent as jest.Mock;

function mockAuth(userId: string, accessToken: string) {
  (useAuth as jest.Mock).mockReturnValue({
    isAuthenticated: true,
    accessToken,
    user: { id: userId },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
});

it('loads the current workspace for a signed-in member', async () => {
  mockAuth('user-1', 'token-1');
  mockGetCurrent.mockResolvedValue(workspace);

  const { result } = renderHook(() => useWorkspace());

  await waitFor(() => expect(result.current).toEqual(workspace));
  expect(mockGetCurrent).toHaveBeenCalledWith('token-1', expect.any(AbortSignal));
});

it('does not probe the workspace for guests', () => {
  (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, accessToken: null });

  const { result } = renderHook(() => useWorkspace());

  expect(result.current).toBeNull();
  expect(mockGetCurrent).not.toHaveBeenCalled();
});

it('keeps the fallback identity when the workspace probe fails', async () => {
  mockAuth('user-1', 'token-1');
  mockGetCurrent.mockRejectedValue(new Error('Network down'));

  const { result } = renderHook(() => useWorkspace());

  await waitFor(() => expect(mockGetCurrent).toHaveBeenCalled());
  expect(result.current).toBeNull();
});

it('seeds the cached identity on the next mount', async () => {
  mockAuth('user-1', 'token-1');
  mockGetCurrent.mockResolvedValue(workspace);

  const first = renderHook(() => useWorkspace());
  await waitFor(() => expect(first.result.current).toEqual(workspace));
  first.unmount();

  mockGetCurrent.mockReturnValue(new Promise(() => {}));
  const second = renderHook(() => useWorkspace());

  expect(second.result.current).toEqual(workspace);
});

it('does not show the previous account workspace after a switch', async () => {
  mockAuth('user-1', 'token-1');
  mockGetCurrent.mockResolvedValue(workspace);

  const { result, rerender } = renderHook(() => useWorkspace());
  await waitFor(() => expect(result.current).toEqual(workspace));

  mockAuth('user-2', 'token-2');
  mockGetCurrent.mockReturnValue(new Promise(() => {}));
  rerender();

  expect(result.current).toBeNull();
});

it('applies a settings update and refreshes the cached identity', async () => {
  mockAuth('user-1', 'token-1');
  mockGetCurrent.mockResolvedValue(workspace);
  const { result } = renderHook(() => useWorkspace());
  await waitFor(() => expect(result.current).toEqual(workspace));

  const updated = { ...workspace, name: 'Renamed', memberCount: 4 };
  act(() => dispatchWorkspaceUpdated(updated));

  expect(result.current).toEqual(updated);
  expect(JSON.parse(window.sessionStorage.getItem('nextdocs.workspace.current') ?? 'null')).toEqual(
    {
      userId: 'user-1',
      workspace: updated,
    }
  );
});
