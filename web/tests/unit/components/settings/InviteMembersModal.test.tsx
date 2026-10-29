import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteMembersModal } from '../../../../components/settings/workspace/InviteMembersModal';
import { ApiError } from '../../../../services/api-client';
import { workspaceApiService } from '../../../../services/workspace.service';
import type { WorkspaceRole } from '../../../../types/auth.types';

jest.mock('../../../../services/workspace.service', () => ({
  workspaceApiService: {
    createInvites: jest.fn(),
  },
}));

const createInvites = workspaceApiService.createInvites as jest.Mock;

function invited(email: string, role: string) {
  return {
    email,
    status: 'INVITED',
    invite: { id: `invite-${email}`, email, role, expiresAt: '2026-11-30T00:00:00Z' },
  };
}

function renderModal({
  isOpen = true,
  actorRole = 'OWNER' as WorkspaceRole,
}: {
  isOpen?: boolean;
  actorRole?: WorkspaceRole;
} = {}) {
  const onClose = jest.fn();
  const onInvited = jest.fn();
  const onNotice = jest.fn();

  render(
    <InviteMembersModal
      isOpen={isOpen}
      accessToken="token-1"
      actorRole={actorRole}
      onClose={onClose}
      onInvited={onInvited}
      onNotice={onNotice}
    />
  );

  return { onClose, onInvited, onNotice };
}

beforeEach(() => jest.clearAllMocks());

describe('InviteMembersModal', () => {
  it('renders nothing when closed', () => {
    renderModal({ isOpen: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends the typed address and reports a single invitation', async () => {
    const user = userEvent.setup();
    createInvites.mockResolvedValue([invited('colleague@example.com', 'MEMBER')]);
    const { onClose, onInvited, onNotice } = renderModal();

    await user.type(screen.getByLabelText('Email addresses'), 'colleague@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(createInvites).toHaveBeenCalledWith('token-1', ['colleague@example.com'], 'MEMBER');
    expect(onInvited).toHaveBeenCalledWith();
    expect(onNotice).toHaveBeenCalledWith({
      kind: 'status',
      message: 'Invitation sent to colleague@example.com.',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('splits the field on commas, semicolons, and whitespace', async () => {
    const user = userEvent.setup();
    createInvites.mockResolvedValue([
      invited('a@example.com', 'MEMBER'),
      invited('b@example.com', 'MEMBER'),
    ]);
    renderModal();

    await user.type(screen.getByLabelText('Email addresses'), 'a@example.com, b@example.com;');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(createInvites).toHaveBeenCalledWith(
      'token-1',
      ['a@example.com', 'b@example.com'],
      'MEMBER'
    );
  });

  it('lets an owner invite at a privileged role', async () => {
    const user = userEvent.setup();
    createInvites.mockResolvedValue([invited('boss@example.com', 'ADMIN')]);
    renderModal();

    await user.click(screen.getByRole('button', { name: /Member/ }));
    expect(screen.getByRole('option', { name: /Owner/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Admin/ }));

    await user.type(screen.getByLabelText('Email addresses'), 'boss@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(createInvites).toHaveBeenCalledWith('token-1', ['boss@example.com'], 'ADMIN');
  });

  it('fixes admins to plain-member invites', async () => {
    const user = userEvent.setup();
    createInvites.mockResolvedValue([invited('new@example.com', 'MEMBER')]);
    renderModal({ actorRole: 'ADMIN' });

    expect(screen.getByRole('button', { name: /Member/ })).toBeDisabled();

    await user.type(screen.getByLabelText('Email addresses'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(createInvites).toHaveBeenCalledWith('token-1', ['new@example.com'], 'MEMBER');
  });

  it('reports an address that is already a member without closing', async () => {
    const user = userEvent.setup();
    createInvites.mockResolvedValue([{ email: 'existing@example.com', status: 'ALREADY_MEMBER' }]);
    const { onClose } = renderModal();

    await user.type(screen.getByLabelText('Email addresses'), 'existing@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'existing@example.com is already a member.'
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports a partial send and closes', async () => {
    const user = userEvent.setup();
    createInvites.mockResolvedValue([
      invited('new@example.com', 'MEMBER'),
      { email: 'existing@example.com', status: 'ALREADY_MEMBER' },
      { email: 'nonsense', status: 'INVALID_EMAIL' },
    ]);
    const { onClose, onNotice } = renderModal();

    await user.type(
      screen.getByLabelText('Email addresses'),
      'new@example.com, existing@example.com'
    );
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(onNotice).toHaveBeenCalledWith({
      kind: 'status',
      message: 'Sent 1 invite. Already a member: existing@example.com. Invalid: nonsense.',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('explains when the instance has no email delivery', async () => {
    const user = userEvent.setup();
    createInvites.mockRejectedValue(new ApiError('Email delivery is not configured', 503));
    renderModal();

    await user.type(screen.getByLabelText('Email addresses'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email delivery is not configured on this instance.'
    );
  });

  it('refuses more addresses than one request allows', async () => {
    const user = userEvent.setup();
    renderModal();

    const emails = Array.from({ length: 21 }, (_, i) => `person${i}@example.com`).join(', ');
    await user.type(screen.getByLabelText('Email addresses'), emails);
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(createInvites).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can invite up to 20 people at a time.'
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('does not dismiss the dialog with Escape while a send is in flight', async () => {
    const user = userEvent.setup();
    let resolveSend: (value: unknown) => void = () => {};
    createInvites.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );
    const { onClose } = renderModal();

    await user.type(screen.getByLabelText('Email addresses'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveSend([invited('new@example.com', 'MEMBER')]);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('closes on Cancel', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });
});
