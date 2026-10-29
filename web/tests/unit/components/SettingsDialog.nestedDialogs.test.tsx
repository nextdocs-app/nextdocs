import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationModal } from '../../../components/ConfirmationModal';
import { SettingsDialog } from '../../../components/settings/SettingsDialog';
import { InviteMembersModal } from '../../../components/settings/workspace/InviteMembersModal';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useTheme } from '../../../hooks/useTheme.hook';
import { getFocusableElements } from '../../../lib/focus-trap.util';

jest.mock('../../../hooks/useTheme.hook', () => ({ useTheme: jest.fn() }));
jest.mock('../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../components/settings/panels/WorkspaceGeneralPanel', () => ({
  WorkspaceGeneralPanel: () => <div>Workspace general panel</div>,
}));
jest.mock('../../../components/settings/panels/WorkspacePeoplePanel', () => ({
  WorkspacePeoplePanel: () => <div>Workspace people panel</div>,
}));

const mockCloseSettings = jest.fn();
const mockCloseNested = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useTheme as jest.Mock).mockReturnValue({ theme: 'system', setTheme: jest.fn() });
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      id: 'user-1',
      email: 'santhosh@example.com',
      displayName: 'Santhosh Kumar',
      avatarUrl: null,
      emailVerified: true,
    },
    isAuthenticated: true,
    isInitializing: false,
  });
});

it('leaves Escape and Tab to a confirmation dialog stacked over it', async () => {
  const user = userEvent.setup();
  render(
    <>
      <SettingsDialog onClose={mockCloseSettings} />
      <ConfirmationModal
        isOpen
        title="Remove member?"
        description="They lose access immediately."
        onConfirm={jest.fn()}
        onCancel={mockCloseNested}
      />
    </>
  );

  const nested = screen.getByRole('dialog', { name: 'Remove member?' });
  const focusable = getFocusableElements(nested);
  focusable[focusable.length - 1].focus();

  await user.tab();
  expect(nested.contains(document.activeElement)).toBe(true);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(mockCloseNested).toHaveBeenCalledTimes(1));
  expect(mockCloseSettings).not.toHaveBeenCalled();
});

it('leaves Escape and Tab to the invite dialog stacked over it', async () => {
  const user = userEvent.setup();
  render(
    <>
      <SettingsDialog onClose={mockCloseSettings} />
      <InviteMembersModal
        isOpen
        accessToken="token-1"
        actorRole="OWNER"
        onClose={mockCloseNested}
        onInvited={jest.fn()}
        onNotice={jest.fn()}
      />
    </>
  );

  const nested = screen.getByRole('dialog', { name: 'Add members' });
  // The dialog focuses its first field after a short delay; let that settle
  // before moving focus to the last control.
  await waitFor(() => expect(screen.getByLabelText('Email addresses')).toHaveFocus());

  const focusable = getFocusableElements(nested);
  focusable[focusable.length - 1].focus();

  await user.tab();
  expect(nested.contains(document.activeElement)).toBe(true);

  await user.keyboard('{Escape}');
  expect(mockCloseNested).toHaveBeenCalledTimes(1);
  expect(mockCloseSettings).not.toHaveBeenCalled();
});
