import { render, screen, waitFor } from '@testing-library/react';
import { WorkspaceEntry } from '../../../components/WorkspaceEntry';
import { useAuth } from '../../../hooks/useAuth.hook';
import { authApiService } from '../../../services/auth.service';
import { hardReplace } from '../../../lib/navigation.util';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  authApiService: {
    getInstanceStatus: jest.fn(),
  },
}));

jest.mock('../../../lib/navigation.util', () => ({
  hardReplace: jest.fn(),
}));

const mockGetInstanceStatus = authApiService.getInstanceStatus as jest.Mock;

function setAuth(isInitializing: boolean, isAuthenticated: boolean) {
  (useAuth as jest.Mock).mockReturnValue({ isInitializing, isAuthenticated });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetInstanceStatus.mockResolvedValue({ initialized: true });
});

it('holds a splash while the session is being restored', () => {
  setAuth(true, false);

  render(<WorkspaceEntry />);

  expect(screen.getByText('Loading your workspace…')).toBeInTheDocument();
  expect(mockGetInstanceStatus).not.toHaveBeenCalled();
  expect(hardReplace).not.toHaveBeenCalled();
});

it('sends a signed-out visitor to sign in on an initialized instance', async () => {
  setAuth(false, false);

  render(<WorkspaceEntry />);

  await waitFor(() => expect(hardReplace).toHaveBeenCalledWith('/login'));
});

it('sends a signed-out visitor to the bootstrap form on a fresh instance', async () => {
  mockGetInstanceStatus.mockResolvedValue({ initialized: false });
  setAuth(false, false);

  render(<WorkspaceEntry />);

  await waitFor(() => expect(hardReplace).toHaveBeenCalledWith('/join'));
});

it('falls back to sign-in when the instance probe fails', async () => {
  mockGetInstanceStatus.mockRejectedValue(new Error('Network down'));
  setAuth(false, false);

  render(<WorkspaceEntry />);

  await waitFor(() => expect(hardReplace).toHaveBeenCalledWith('/login'));
});

it('keeps the splash for a restored session instead of going blank', () => {
  setAuth(true, true);

  render(<WorkspaceEntry />);

  expect(screen.getByText('Loading your workspace…')).toBeInTheDocument();
  expect(mockGetInstanceStatus).not.toHaveBeenCalled();
  expect(hardReplace).not.toHaveBeenCalled();
});
