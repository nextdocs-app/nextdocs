import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspacePendingInvites } from '../../../../components/settings/workspace/WorkspacePendingInvites';
import { ApiError } from '../../../../services/api-client';
import { workspaceApiService } from '../../../../services/workspace.service';
import type { WorkspaceInvite, WorkspacePage } from '../../../../types/workspace.types';

jest.mock('../../../../services/workspace.service', () => ({
  workspaceApiService: {
    listInvites: jest.fn(),
    resendInvite: jest.fn(),
    revokeInvite: jest.fn(),
  },
}));

const listInvites = workspaceApiService.listInvites as jest.Mock;
const resendInvite = workspaceApiService.resendInvite as jest.Mock;
const revokeInvite = workspaceApiService.revokeInvite as jest.Mock;

function page(
  content: WorkspaceInvite[],
  { number = 0, last = true }: { number?: number; last?: boolean } = {}
): WorkspacePage<WorkspaceInvite> {
  return {
    content,
    totalElements: content.length,
    totalPages: last ? number + 1 : number + 2,
    size: 20,
    number,
    first: number === 0,
    last,
  };
}

const memberInvite: WorkspaceInvite = {
  id: 'invite-member',
  email: 'new@example.com',
  role: 'MEMBER',
  expiresAt: '2026-11-30T00:00:00Z',
  createdAt: '2026-10-30T00:00:00Z',
};

const ownerInvite: WorkspaceInvite = {
  id: 'invite-owner',
  email: 'boss@example.com',
  role: 'OWNER',
  expiresAt: '2026-11-30T00:00:00Z',
  createdAt: '2026-10-30T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  listInvites.mockResolvedValue(page([]));
});

describe('WorkspacePendingInvites', () => {
  it('renders nothing for regular members', () => {
    const { container } = render(
      <WorkspacePendingInvites accessToken="token-1" actorRole="MEMBER" />
    );

    expect(container.firstChild).toBeNull();
    expect(listInvites).not.toHaveBeenCalled();
  });

  it('renders empty state when there are no pending invites', async () => {
    render(<WorkspacePendingInvites accessToken="token-1" actorRole="OWNER" />);

    expect(await screen.findByText('No pending invites.')).toBeInTheDocument();
  });

  it('renders pending invites table with invitee details', async () => {
    listInvites.mockResolvedValue(page([memberInvite]));
    render(<WorkspacePendingInvites accessToken="token-1" actorRole="OWNER" />);

    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('resends an invite and adopts the rotated expiry', async () => {
    const user = userEvent.setup();
    listInvites.mockResolvedValue(page([memberInvite]));
    resendInvite.mockResolvedValue({
      id: memberInvite.id,
      email: memberInvite.email,
      role: 'MEMBER',
      expiresAt: '2026-12-15T00:00:00Z',
    });
    render(<WorkspacePendingInvites accessToken="token-1" actorRole="OWNER" />);

    await screen.findByText('new@example.com');
    await user.click(screen.getByRole('button', { name: 'Resend' }));

    expect(resendInvite).toHaveBeenCalledWith('token-1', 'invite-member');
    expect(await screen.findByText('Invitation resent to new@example.com.')).toBeInTheDocument();
  });

  it('revokes an invite and removes it from the list', async () => {
    const user = userEvent.setup();
    listInvites.mockResolvedValue(page([memberInvite]));
    revokeInvite.mockResolvedValue(undefined);
    render(<WorkspacePendingInvites accessToken="token-1" actorRole="OWNER" />);

    await screen.findByText('new@example.com');
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(revokeInvite).toHaveBeenCalledWith('token-1', 'invite-member');
    expect(await screen.findByText('Invitation to new@example.com revoked.')).toBeInTheDocument();
    expect(screen.queryByText('new@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('No pending invites.')).toBeInTheDocument();
  });

  it('leaves privileged invites to owners when an admin is reading', async () => {
    listInvites.mockResolvedValue(page([ownerInvite]));
    render(<WorkspacePendingInvites accessToken="token-1" actorRole="ADMIN" />);

    expect(await screen.findByText('boss@example.com')).toBeInTheDocument();
    expect(screen.getByText('Owner-managed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('loads the next page of pending invites', async () => {
    const user = userEvent.setup();
    listInvites.mockImplementation((_token: string, requestPage: number) =>
      Promise.resolve(
        requestPage === 0
          ? page([memberInvite], { last: false })
          : page([ownerInvite], { number: 1 })
      )
    );
    render(<WorkspacePendingInvites accessToken="token-1" actorRole="OWNER" />);

    await screen.findByText('new@example.com');
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(listInvites).toHaveBeenLastCalledWith('token-1', 1, 20);
    expect(await screen.findByText('boss@example.com')).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
  });

  it('offers a retry when the pending list cannot load', async () => {
    const user = userEvent.setup();
    listInvites
      .mockRejectedValueOnce(new ApiError('Invites unavailable', 500))
      .mockResolvedValueOnce(page([memberInvite]));
    render(<WorkspacePendingInvites accessToken="token-1" actorRole="OWNER" />);

    expect(await screen.findByText('Invites unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
  });
});
