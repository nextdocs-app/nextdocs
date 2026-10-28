import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspacePeoplePanel } from '../../../../components/settings/panels/WorkspacePeoplePanel';
import { useAuth } from '../../../../hooks/useAuth.hook';
import { dispatchWorkspaceUpdated } from '../../../../lib/workspace-event.util';
import { ApiError } from '../../../../services/api-client';
import { workspaceApiService } from '../../../../services/workspace.service';
import type { WorkspaceMember } from '../../../../types/workspace.types';

jest.mock('../../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../services/workspace.service', () => ({
  workspaceApiService: {
    getCurrent: jest.fn(),
    listMembers: jest.fn(),
  },
}));
jest.mock('../../../../lib/workspace-event.util', () => ({
  dispatchWorkspaceUpdated: jest.fn(),
}));
jest.mock('../../../../components/settings/workspace/WorkspaceInviteSection', () => ({
  WorkspaceInviteSection: ({ actorRole }: { actorRole: string }) => (
    <p>Invite section for {actorRole}</p>
  ),
}));
jest.mock('../../../../components/settings/workspace/WorkspaceMemberList', () => ({
  WorkspaceMemberList: ({
    actorRole,
    members,
    onRosterChange,
    onRefresh,
  }: {
    actorRole: string;
    members: WorkspaceMember[];
    onRosterChange: (members: WorkspaceMember[]) => void;
    onRefresh: () => void;
  }) => (
    <div>
      <p>
        Roster for {actorRole}: {members.length}
      </p>
      <button
        type="button"
        onClick={() =>
          onRosterChange(
            members.map((member) =>
              member.userId === 'owner-1' ? { ...member, role: 'MEMBER' } : member
            )
          )
        }
      >
        Demote self
      </button>
      <button type="button" onClick={onRefresh}>
        Refresh roster
      </button>
    </div>
  ),
}));

const getCurrent = workspaceApiService.getCurrent as jest.Mock;
const listMembers = workspaceApiService.listMembers as jest.Mock;
const dispatchUpdated = dispatchWorkspaceUpdated as jest.Mock;

const ownerMember: WorkspaceMember = {
  userId: 'owner-1',
  email: 'ada@example.com',
  displayName: 'Ada Owner',
  avatarUrl: null,
  role: 'OWNER',
  joinedAt: '2026-01-05T10:00:00Z',
};

const secondMember: WorkspaceMember = {
  userId: 'member-1',
  email: 'bob@example.com',
  displayName: 'Bob Member',
  avatarUrl: null,
  role: 'MEMBER',
  joinedAt: '2026-03-20T10:00:00Z',
};

const workspace = {
  id: 'workspace-1',
  name: 'Acme',
  icon: null,
  role: 'OWNER' as const,
  memberCount: 2,
};

function mockAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    isAuthenticated: true,
    isInitializing: false,
    accessToken: 'token-1',
    user: { id: 'owner-1' },
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth();
  getCurrent.mockResolvedValue(workspace);
  listMembers.mockResolvedValue([ownerMember, secondMember]);
});

describe('WorkspacePeoplePanel', () => {
  it('shows the signed-out state without probing the API', () => {
    mockAuth({ isAuthenticated: false, accessToken: null, user: null });

    render(<WorkspacePeoplePanel />);

    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(getCurrent).not.toHaveBeenCalled();
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('shows every member the roster without management controls', async () => {
    getCurrent.mockResolvedValue({ ...workspace, role: 'MEMBER' });
    mockAuth({ user: { id: 'member-1' } });
    render(<WorkspacePeoplePanel />);

    expect(await screen.findByText('Roster for MEMBER: 2')).toBeInTheDocument();
    expect(screen.queryByText('Invite section for MEMBER')).not.toBeInTheDocument();
    expect(
      screen.getByText('Only workspace owners and admins can invite people or change roles.')
    ).toBeInTheDocument();
    expect(getCurrent).toHaveBeenCalledWith('token-1', expect.any(AbortSignal));
    expect(listMembers).toHaveBeenCalledWith('token-1', expect.any(AbortSignal));
  });

  it('mounts invite management for owners', async () => {
    render(<WorkspacePeoplePanel />);

    expect(await screen.findByText('Roster for OWNER: 2')).toBeInTheDocument();
    expect(screen.getByText('Invite section for OWNER')).toBeInTheDocument();
  });

  it('mounts invite management for admins', async () => {
    getCurrent.mockResolvedValue({ ...workspace, role: 'ADMIN' });
    mockAuth({ user: { id: 'admin-1' } });
    render(<WorkspacePeoplePanel />);

    expect(await screen.findByText('Roster for ADMIN: 2')).toBeInTheDocument();
    expect(screen.getByText('Invite section for ADMIN')).toBeInTheDocument();
  });

  it('retires management controls when a self-demotion lands', async () => {
    const user = userEvent.setup();
    render(<WorkspacePeoplePanel />);
    await screen.findByText('Roster for OWNER: 2');

    await user.click(screen.getByRole('button', { name: 'Demote self' }));

    expect(screen.getByText('Roster for MEMBER: 2')).toBeInTheDocument();
    expect(screen.queryByText('Invite section for MEMBER')).not.toBeInTheDocument();
    expect(dispatchUpdated).toHaveBeenCalledWith({
      ...workspace,
      role: 'MEMBER',
      memberCount: 2,
    });
  });

  it('reports a failed initial load and retries', async () => {
    const user = userEvent.setup();
    getCurrent.mockRejectedValueOnce(new ApiError('Members unavailable', 500));
    render(<WorkspacePeoplePanel />);

    expect(await screen.findByText('Members unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Roster for OWNER: 2')).toBeInTheDocument();
  });

  it('keeps the roster but reports a refresh failure', async () => {
    const user = userEvent.setup();
    listMembers
      .mockResolvedValueOnce([ownerMember, secondMember])
      .mockRejectedValueOnce(new ApiError('Roster unavailable', 500));
    render(<WorkspacePeoplePanel />);
    await screen.findByText('Roster for OWNER: 2');

    await user.click(screen.getByRole('button', { name: 'Refresh roster' }));

    expect(await screen.findByText('Roster unavailable')).toBeInTheDocument();
    expect(screen.getByText('Roster for OWNER: 2')).toBeInTheDocument();
  });
});
