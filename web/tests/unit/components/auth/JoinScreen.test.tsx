import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinScreen } from '../../../../components/auth/JoinScreen';
import { authApiService } from '../../../../services/auth.service';
import { INVITE_TOKEN_STORAGE_KEY } from '../../../../lib/invite-token.util';
import { hardNavigate } from '../../../../lib/navigation.util';
import type { InvitePreview } from '../../../../types/auth.types';

jest.mock('../../../../services/auth.service', () => ({
  authApiService: {
    previewInvite: jest.fn(),
    register: jest.fn(),
    getInstanceStatus: jest.fn(),
  },
}));

jest.mock('../../../../lib/navigation.util', () => ({
  hardNavigate: jest.fn(),
}));

const mockPreviewInvite = authApiService.previewInvite as jest.Mock;
const mockRegister = authApiService.register as jest.Mock;
const mockGetInstanceStatus = authApiService.getInstanceStatus as jest.Mock;

const preview: InvitePreview = {
  email: 'invitee@example.com',
  workspaceName: 'Acme',
  role: 'MEMBER',
  expiresAt: '2030-01-15T12:00:00Z',
};

function setHash(hash: string) {
  window.history.replaceState(null, '', `/join${hash}`);
}

function stashInviteToken(token: string) {
  window.sessionStorage.setItem(INVITE_TOKEN_STORAGE_KEY, token);
}

async function renderJoin() {
  render(<JoinScreen />);
  return screen.findByRole('heading', { name: 'Join Acme' });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  window.sessionStorage.clear();
  mockGetInstanceStatus.mockResolvedValue({ initialized: true });
  mockPreviewInvite.mockResolvedValue(preview);
});

it('previews the invite and fixes the email to the invited address', async () => {
  setHash('#token=invite-token');

  await renderJoin();

  expect(mockPreviewInvite).toHaveBeenCalledWith('invite-token');
  const email = screen.getByLabelText('Email');
  expect(email).toHaveValue('invitee@example.com');
  expect(email).toHaveAttribute('readonly');
  expect(screen.getByText('Member')).toBeInTheDocument();
  expect(screen.getByText('Jan 15, 2030')).toBeInTheDocument();
});

it('consumes the token from the visible URL immediately', async () => {
  setHash('#token=invite-token');

  await renderJoin();

  expect(window.location.hash).toBe('');
  expect(window.location.search).toBe('');
});

it('keeps the invite working when the tab reloads after the fragment is gone', async () => {
  setHash('#token=invite-token');

  const { unmount } = render(<JoinScreen />);
  await screen.findByRole('heading', { name: 'Join Acme' });
  unmount();

  // A reload re-runs the page with no fragment left to read.
  render(<JoinScreen />);

  expect(await screen.findByRole('heading', { name: 'Join Acme' })).toBeInTheDocument();
  expect(mockPreviewInvite).toHaveBeenLastCalledWith('invite-token');
  expect(mockGetInstanceStatus).not.toHaveBeenCalled();
});

it('prefers a freshly opened invite link over the stashed token', async () => {
  stashInviteToken('earlier-token');
  setHash('#token=new-token');

  await renderJoin();

  expect(mockPreviewInvite).toHaveBeenCalledWith('new-token');
  expect(window.sessionStorage.getItem(INVITE_TOKEN_STORAGE_KEY)).toBe('new-token');
});

it('picks up an invite that arrives after mount by fragment navigation', async () => {
  render(<JoinScreen />);
  await screen.findByRole('heading', { name: 'An invitation is required' });

  // Pasting an invite link into a tab that is already on this page changes only
  // the fragment: the page never re-mounts, so the token must still be read.
  setHash('#token=late-token');
  window.dispatchEvent(new HashChangeEvent('hashchange'));

  expect(await screen.findByRole('heading', { name: 'Join Acme' })).toBeInTheDocument();
  expect(mockPreviewInvite).toHaveBeenCalledWith('late-token');
  expect(window.sessionStorage.getItem(INVITE_TOKEN_STORAGE_KEY)).toBe('late-token');
  expect(window.location.hash).toBe('');
});

it('drops the stashed token once the account is registered', async () => {
  mockRegister.mockResolvedValue({});
  setHash('#token=invite-token');
  const user = userEvent.setup();
  await renderJoin();

  await user.type(screen.getByLabelText('Full name'), 'Jane Doe');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  await waitFor(() => expect(window.sessionStorage.getItem(INVITE_TOKEN_STORAGE_KEY)).toBeNull());
});

it('registers with the invite token and full-navigates into the workspace', async () => {
  mockRegister.mockResolvedValue({});
  setHash('#token=invite-token');
  const user = userEvent.setup();
  await renderJoin();

  await user.type(screen.getByLabelText('Full name'), 'Jane Doe');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  await waitFor(() =>
    expect(mockRegister).toHaveBeenCalledWith({
      email: 'invitee@example.com',
      displayName: 'Jane Doe',
      password: 'password123',
      inviteToken: 'invite-token',
    })
  );
  expect(hardNavigate).toHaveBeenCalledWith('/');
});

it('blocks submission when the passwords differ', async () => {
  const user = userEvent.setup();
  setHash('#token=invite-token');
  await renderJoin();

  await user.type(screen.getByLabelText('Full name'), 'Jane Doe');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password124');
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
  expect(mockRegister).not.toHaveBeenCalled();
  expect(hardNavigate).not.toHaveBeenCalled();
});

it('shows the API error and stays on the form when registration fails', async () => {
  mockRegister.mockRejectedValue(new Error('Email already exists'));
  setHash('#token=invite-token');
  const user = userEvent.setup();
  await renderJoin();

  await user.type(screen.getByLabelText('Full name'), 'Jane Doe');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Email already exists');
  expect(hardNavigate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Full name')).toBeInTheDocument();
});

it('explains an unusable invite and offers the sign-in page', async () => {
  mockPreviewInvite.mockRejectedValue(new Error('Invitation has expired'));
  setHash('#token=stale-token');

  render(<JoinScreen />);

  expect(
    await screen.findByRole('heading', { name: 'Invitation unavailable' })
  ).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Invitation has expired');
  expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
});

it('asks for an invitation when the link carries no token', async () => {
  render(<JoinScreen />);

  expect(
    await screen.findByRole('heading', { name: 'An invitation is required' })
  ).toBeInTheDocument();
  expect(mockGetInstanceStatus).toHaveBeenCalledTimes(1);
  expect(mockPreviewInvite).not.toHaveBeenCalled();
  for (const link of screen.getAllByRole('link', { name: 'Sign in' })) {
    expect(link).toHaveAttribute('href', '/login');
  }
});

it('falls back to the invite-only card when the status probe fails', async () => {
  mockGetInstanceStatus.mockRejectedValue(new Error('Network down'));

  render(<JoinScreen />);

  expect(
    await screen.findByRole('heading', { name: 'An invitation is required' })
  ).toBeInTheDocument();
});

it('bootstraps the first account on an uninitialized instance', async () => {
  mockGetInstanceStatus.mockResolvedValue({ initialized: false });
  mockRegister.mockResolvedValue({});
  const user = userEvent.setup();

  render(<JoinScreen />);

  expect(await screen.findByRole('heading', { name: 'Set up this instance' })).toBeInTheDocument();
  expect(screen.queryByText('Already have an account?')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();

  const email = screen.getByLabelText('Email');
  expect(email).not.toHaveAttribute('readonly');
  expect(screen.queryByText('Role')).not.toBeInTheDocument();

  await user.type(email, 'owner@example.com');
  await user.type(screen.getByLabelText('Full name'), 'Workspace Owner');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  await waitFor(() =>
    expect(mockRegister).toHaveBeenCalledWith({
      email: 'owner@example.com',
      displayName: 'Workspace Owner',
      password: 'password123',
    })
  );
  expect(hardNavigate).toHaveBeenCalledWith('/');
});
