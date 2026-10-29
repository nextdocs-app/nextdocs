import { act, render, screen, waitFor } from '@testing-library/react';
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
    panelRef,
    onSelect,
    onRemove,
    onClose,
  }: {
    panelRef?: React.RefObject<HTMLDivElement | null>;
    onSelect: (icon: { type: string; value: string }) => void;
    onRemove: () => void;
    onClose: () => void;
  }) => (
    <div ref={panelRef}>
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

  it('sends only the changed name on blur', async () => {
    const user = userEvent.setup();
    updateCurrent.mockResolvedValue({ ...ownerWorkspace, name: 'Renamed' });
    render(<WorkspaceGeneralPanel />);

    const input = await screen.findByDisplayValue('Acme');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.tab();

    expect(updateCurrent).toHaveBeenCalledWith('token-1', { name: 'Renamed' });
    expect(dispatchUpdated).toHaveBeenCalledWith({ ...ownerWorkspace, name: 'Renamed' });
  });

  it('sends the changed name on Enter', async () => {
    const user = userEvent.setup();
    updateCurrent.mockResolvedValue({ ...ownerWorkspace, name: 'Renamed' });
    render(<WorkspaceGeneralPanel />);

    const input = await screen.findByDisplayValue('Acme');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');

    expect(updateCurrent).toHaveBeenCalledWith('token-1', { name: 'Renamed' });
    expect(dispatchUpdated).toHaveBeenCalledWith({ ...ownerWorkspace, name: 'Renamed' });
  });

  it('reverts an empty name on blur without calling the API', async () => {
    const user = userEvent.setup();
    render(<WorkspaceGeneralPanel />);

    const input = await screen.findByDisplayValue('Acme');
    await user.clear(input);
    await user.tab();

    expect(updateCurrent).not.toHaveBeenCalled();
    expect(input).toHaveValue('Acme');
  });

  it('saves a newly picked icon immediately', async () => {
    const user = userEvent.setup();
    updateCurrent.mockResolvedValue({
      ...ownerWorkspace,
      icon: { type: 'emoji', value: '🚀' },
    });
    render(<WorkspaceGeneralPanel />);
    await screen.findByDisplayValue('Acme');

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    await user.click(screen.getByRole('button', { name: 'Pick rocket' }));

    expect(updateCurrent).toHaveBeenCalledWith('token-1', {
      icon: { type: 'emoji', value: '🚀' },
    });
  });

  it('clears an existing icon through the icon picker', async () => {
    const user = userEvent.setup();
    getCurrent.mockResolvedValue({ ...ownerWorkspace, icon: { type: 'emoji', value: '📚' } });
    updateCurrent.mockResolvedValue(ownerWorkspace);
    render(<WorkspaceGeneralPanel />);
    await screen.findByDisplayValue('Acme');

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change workspace icon' }));
    await user.click(screen.getByRole('button', { name: 'Clear icon' }));

    expect(updateCurrent).toHaveBeenCalledWith('token-1', {
      icon: { type: null, value: null },
    });
  });

  it('changes an existing icon through the popover', async () => {
    const user = userEvent.setup();
    getCurrent.mockResolvedValue({ ...ownerWorkspace, icon: { type: 'emoji', value: '📚' } });
    updateCurrent.mockResolvedValue({
      ...ownerWorkspace,
      icon: { type: 'emoji', value: '🚀' },
    });
    render(<WorkspaceGeneralPanel />);
    await screen.findByDisplayValue('Acme');

    await user.click(screen.getByRole('button', { name: 'Change workspace icon' }));
    await user.click(screen.getByRole('button', { name: 'Pick rocket' }));

    expect(updateCurrent).toHaveBeenCalledWith('token-1', {
      icon: { type: 'emoji', value: '🚀' },
    });
  });

  it('renders a colored builtin icon with a matching tinted background in settings', async () => {
    getCurrent.mockResolvedValue({
      ...ownerWorkspace,
      icon: { type: 'builtin', value: 'rocket', color: 'red' },
    });
    const { container } = render(<WorkspaceGeneralPanel />);
    await screen.findByDisplayValue('Acme');

    const button = container.querySelector('button[style*="color-mix"]');
    expect(button).toBeInTheDocument();
    expect(button).toHaveStyle({
      backgroundColor: 'color-mix(in srgb, var(--nd-icon-color-red) 18%, transparent)',
      color: 'var(--nd-icon-color-red)',
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
    await user.type(input, '!{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only owners can update the workspace.'
    );
    await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(2));
  });

  it('never overwrites text typed while a queued save is in flight', async () => {
    const user = userEvent.setup();
    let resolveSave: (value: typeof ownerWorkspace) => void = () => {};
    updateCurrent.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const { container } = render(<WorkspaceGeneralPanel />);

    const input = await screen.findByDisplayValue('Acme');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.tab();

    // Still saving: the panel stays busy while the request is outstanding.
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();

    // The user comes back to the field before the response lands.
    await user.click(input);
    await user.type(input, 'Draft');

    await act(async () => {
      resolveSave({ ...ownerWorkspace, name: 'Renamed' });
    });

    expect(input).toHaveValue('RenamedDraft');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
  });

  it('puts the stored name back when a save fails and nothing newer was typed', async () => {
    const user = userEvent.setup();
    updateCurrent.mockRejectedValue(new ApiError('Nope', 500));
    render(<WorkspaceGeneralPanel />);

    const input = await screen.findByDisplayValue('Acme');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.tab();

    await waitFor(() => expect(input).toHaveValue('Acme'));
  });
});
