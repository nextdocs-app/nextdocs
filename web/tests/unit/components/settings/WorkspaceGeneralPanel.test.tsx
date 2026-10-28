import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceGeneralPanel } from '../../../../components/settings/panels/WorkspaceGeneralPanel';
import { useAuth } from '../../../../hooks/useAuth.hook';
import { dispatchWorkspaceUpdated } from '../../../../lib/workspace-event.util';
import { ApiError } from '../../../../services/api-client';
import { workspaceApiService } from '../../../../services/workspace.service';

jest.mock('../../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../services/workspace.service', () => ({
  workspaceApiService: {
    getCurrent: jest.fn(),
    updateCurrent: jest.fn(),
    uploadIcon: jest.fn(),
  },
}));
jest.mock('../../../../lib/workspace-event.util', () => ({
  dispatchWorkspaceUpdated: jest.fn(),
}));
jest.mock('../../../../components/page/IconPickerPanel', () => ({
  IconPickerPanel: ({
    onSelect,
    onRemove,
    onClose,
  }: {
    onSelect: (icon: { type: string; value: string }) => void;
    onRemove: () => void;
    onClose: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelect({ type: 'emoji', value: '🚀' })}>
        Pick rocket
      </button>
      <button type="button" onClick={onRemove}>
        Clear icon
      </button>
      <button type="button" onClick={onClose}>
        Close picker
      </button>
    </div>
  ),
}));

const getCurrent = workspaceApiService.getCurrent as jest.Mock;
const updateCurrent = workspaceApiService.updateCurrent as jest.Mock;
const dispatchUpdated = dispatchWorkspaceUpdated as jest.Mock;

const ownerWorkspace = {
  id: 'workspace-1',
  name: 'Acme',
  icon: null,
  role: 'OWNER' as const,
  memberCount: 3,
};

function mockAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    isAuthenticated: true,
    isInitializing: false,
    accessToken: 'token-1',
    user: { id: 'user-1' },
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth();
  getCurrent.mockResolvedValue(ownerWorkspace);
});

describe('WorkspaceGeneralPanel', () => {
  it('shows the signed-out state without probing the API', () => {
    mockAuth({ isAuthenticated: false, accessToken: null });

    render(<WorkspaceGeneralPanel />);

    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it('loads the workspace name, icon, and the caller role', async () => {
    render(<WorkspaceGeneralPanel />);

    expect(await screen.findByDisplayValue('Acme')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(getCurrent).toHaveBeenCalledWith('token-1', expect.any(AbortSignal));
  });

  it('sends only the changed name and reports the save', async () => {
    const user = userEvent.setup();
    updateCurrent.mockResolvedValue({ ...ownerWorkspace, name: 'Renamed' });
    render(<WorkspaceGeneralPanel />);

    const input = await screen.findByDisplayValue('Acme');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateCurrent).toHaveBeenCalledWith('token-1', { name: 'Renamed' });
    expect(await screen.findByText('Workspace saved.')).toBeInTheDocument();
    expect(dispatchUpdated).toHaveBeenCalledWith({ ...ownerWorkspace, name: 'Renamed' });
  });

  it('saves a newly picked icon', async () => {
    const user = userEvent.setup();
    updateCurrent.mockResolvedValue({
      ...ownerWorkspace,
      icon: { type: 'emoji', value: '🚀' },
    });
    render(<WorkspaceGeneralPanel />);
    await screen.findByDisplayValue('Acme');

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    await user.click(screen.getByRole('button', { name: 'Pick rocket' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateCurrent).toHaveBeenCalledWith('token-1', {
      icon: { type: 'emoji', value: '🚀' },
    });
  });

  it('clears an existing icon through a null icon payload', async () => {
    const user = userEvent.setup();
    getCurrent.mockResolvedValue({ ...ownerWorkspace, icon: { type: 'emoji', value: '📚' } });
    updateCurrent.mockResolvedValue(ownerWorkspace);
    render(<WorkspaceGeneralPanel />);
    await screen.findByDisplayValue('Acme');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateCurrent).toHaveBeenCalledWith('token-1', {
      icon: { type: null, value: null },
    });
  });

  it('keeps a non-owner read-only with an explanation', async () => {
    getCurrent.mockResolvedValue({ ...ownerWorkspace, role: 'MEMBER' });
    render(<WorkspaceGeneralPanel />);

    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add icon' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the workspace owner/)).toBeInTheDocument();
  });

  it('reports a failed save and reloads when the role changed underneath', async () => {
    const user = userEvent.setup();
    updateCurrent.mockRejectedValue(new ApiError('Only owners can update the workspace.', 403));
    render(<WorkspaceGeneralPanel />);

    const input = await screen.findByDisplayValue('Acme');
    await user.type(input, '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only owners can update the workspace.'
    );
    await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(2));
  });
});
