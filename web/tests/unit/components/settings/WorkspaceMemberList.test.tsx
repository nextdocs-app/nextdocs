import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceMemberList } from '../../../../components/settings/workspace/WorkspaceMemberList';
import { ApiError } from '../../../../services/api-client';
import { workspaceApiService } from '../../../../services/workspace.service';
import type { WorkspaceMember } from '../../../../types/workspace.types';

jest.mock('../../../../services/workspace.service', () => ({
  workspaceApiService: {
    updateMemberRole: jest.fn(),
    removeMember: jest.fn(),
  },
}));

const updateMemberRole = workspaceApiService.updateMemberRole as jest.Mock;
const removeMember = workspaceApiService.removeMember as jest.Mock;

const owner: WorkspaceMember = {
  userId: 'owner-1',
  email: 'ada@example.com',
  displayName: 'Ada Owner',
  avatarUrl: null,
  role: 'OWNER',
  joinedAt: '2026-01-05T10:00:00Z',
};

const admin: WorkspaceMember = {
  userId: 'admin-1',
  email: 'grace@example.com',
  displayName: 'Grace Admin',
  avatarUrl: null,
  role: 'ADMIN',
  joinedAt: '2026-02-10T10:00:00Z',
};

const member: WorkspaceMember = {
  userId: 'member-1',
  email: 'bob@example.com',
  displayName: 'Bob Member',
  avatarUrl: null,
  role: 'MEMBER',
  joinedAt: '2026-03-20T10:00:00Z',
};

function renderList({
  members = [owner, admin, member],
  actorRole = 'OWNER',
  selfId = 'owner-1',
  onRosterChange = jest.fn(),
  onRefresh = jest.fn(),
  onNotice = jest.fn(),
}: {
  members?: WorkspaceMember[];
  actorRole?: 'OWNER' | 'ADMIN' | 'MEMBER';
  selfId?: string;
  onRosterChange?: jest.Mock;
  onRefresh?: jest.Mock;
  onNotice?: jest.Mock;
} = {}) {
  render(
    <WorkspaceMemberList
      members={members}
      actorRole={actorRole}
      selfId={selfId}
      accessToken="token-1"
      onRosterChange={onRosterChange}
      onRefresh={onRefresh}
      onNotice={onNotice}
    />
  );

  return { onRosterChange, onRefresh, onNotice };
}

beforeEach(() => jest.clearAllMocks());

describe('WorkspaceMemberList', () => {
  it('shows the roster with join dates for every member', () => {
    renderList();

    expect(screen.getByText('Ada Owner')).toBeInTheDocument();
    expect(screen.getByText('Grace Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Member')).toBeInTheDocument();
    expect(screen.getByText(/bob@example\.com · Joined/)).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('gives owners a role dropdown for everyone but themselves', () => {
    renderList();

    expect(screen.queryByRole('button', { name: 'Role for Ada Owner' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Role for Grace Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Role for Bob Member' })).toBeInTheDocument();
  });

  it('changes a role through the API and adopts the returned roster', async () => {
    const user = userEvent.setup();
    const roster = [{ ...admin, role: 'MEMBER' as const }, owner, member];
    updateMemberRole.mockResolvedValue(roster);
    const { onRosterChange, onNotice } = renderList();

    await user.click(screen.getByRole('button', { name: 'Role for Grace Admin' }));
    await user.click(screen.getByRole('option', { name: 'Member' }));

    expect(updateMemberRole).toHaveBeenCalledWith('token-1', 'admin-1', 'MEMBER');
    expect(onRosterChange).toHaveBeenCalledWith(roster);
    expect(onNotice).toHaveBeenCalledWith({
      kind: 'status',
      message: 'Grace Admin is now Member.',
    });
  });

  it('refreshes the roster when a role change is rejected', async () => {
    const user = userEvent.setup();
    updateMemberRole.mockRejectedValue(new ApiError('Not allowed', 403));
    const { onRefresh, onNotice } = renderList();

    await user.click(screen.getByRole('button', { name: 'Role for Bob Member' }));
    await user.click(screen.getByRole('option', { name: 'Admin' }));

    expect(onRefresh).toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith({ kind: 'error', message: 'Not allowed' });
  });

  it('confirms before removing a member', async () => {
    const user = userEvent.setup();
    removeMember.mockResolvedValue([owner, admin]);
    const { onRosterChange, onNotice } = renderList();

    await user.click(screen.getByRole('button', { name: 'Remove Bob Member' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Remove Bob Member?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(removeMember).toHaveBeenCalledWith('token-1', 'member-1');
    expect(onRosterChange).toHaveBeenCalledWith([owner, admin]);
    expect(onNotice).toHaveBeenCalledWith({
      kind: 'status',
      message: 'Bob Member was removed from the workspace.',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets admins remove plain members but not owners or other admins', () => {
    renderList({ actorRole: 'ADMIN', selfId: 'admin-1' });

    expect(screen.queryByRole('button', { name: 'Remove Ada Owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Grace Admin' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Bob Member' })).toBeInTheDocument();
    // Admins cannot change roles at all, so every role is a plain label.
    expect(screen.queryByRole('button', { name: /^Role for/ })).not.toBeInTheDocument();
  });

  it('keeps members read-only', () => {
    renderList({ actorRole: 'MEMBER', selfId: 'member-1' });

    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Role for/ })).not.toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('does not let the last owner demote themselves', () => {
    renderList({ members: [owner], selfId: 'owner-1' });

    expect(screen.queryByRole('button', { name: 'Role for Ada Owner' })).not.toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });
});
