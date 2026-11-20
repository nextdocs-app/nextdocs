import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePanel } from '../../../../components/settings/panels/ProfilePanel';
import { useAuth } from '../../../../hooks/useAuth.hook';
import { prepareAvatarUpload } from '../../../../lib/avatar-image.util';
import { updateProfileThunk } from '../../../../stores/auth/auth.slice';
import { addToast } from '../../../../stores/toasts/toasts.slice';
import type { AuthUser } from '../../../../types/auth.types';

jest.mock('../../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../stores/hooks', () => ({ useAppDispatch: jest.fn() }));
jest.mock('../../../../stores/toasts/toasts.slice', () => ({ addToast: jest.fn() }));
jest.mock('../../../../lib/avatar-image.util', () => ({
  prepareAvatarUpload: jest.fn((file: File) => Promise.resolve(file)),
}));
jest.mock('../../../../stores/auth/auth.slice', () => ({
  updateProfileThunk: Object.assign(jest.fn(), {
    rejected: { match: (action: { type?: string }) => action?.type?.endsWith('/rejected') },
  }),
}));

const { useAppDispatch } = jest.requireMock('../../../../stores/hooks') as {
  useAppDispatch: jest.Mock;
};

const user: AuthUser = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
};

const dispatchMock = jest.fn();

function signIn(): void {
  (useAuth as jest.Mock).mockReturnValue({
    user,
    isAuthenticated: true,
    isInitializing: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // jsdom has no object-URL implementation; the preview is the only consumer here.
  URL.createObjectURL = jest.fn(() => 'blob:preview');
  URL.revokeObjectURL = jest.fn();
  dispatchMock.mockResolvedValue({
    type: 'auth/updateProfile/fulfilled',
    payload: { user, sessionId: 0 },
  });
  useAppDispatch.mockReturnValue(dispatchMock);
  signIn();
});

it('offers an editable display name now that the API accepts one', () => {
  render(<ProfilePanel />);

  expect(screen.getByLabelText('Display name')).toBeEnabled();
});

it('commits a rename on blur and stores the account the API returned', async () => {
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  const input = screen.getByLabelText('Display name');
  await typed.clear(input);
  await typed.type(input, 'Ada L');
  await typed.tab();

  await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
  expect(updateProfileThunk).toHaveBeenCalledWith({ displayName: 'Ada L' });
  expect(addToast).toHaveBeenCalledWith({ message: 'Display name updated.', type: 'success' });
});

it('keeps the previous name when the rename is rejected', async () => {
  dispatchMock.mockResolvedValueOnce({
    type: 'auth/updateProfile/rejected',
    payload: 'Display name must be at most 100 characters',
  });
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  const input = screen.getByLabelText('Display name');
  await typed.clear(input);
  await typed.type(input, 'Ada L');
  await typed.tab();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Display name must be at most 100 characters'
  );
  expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
});

it('uploads a picked photo and shows the new one from the store', async () => {
  const { container } = render(<ProfilePanel />);

  const file = new File(['png'], 'portrait.png', { type: 'image/png' });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
  expect(prepareAvatarUpload).toHaveBeenCalledWith(file);
  expect(updateProfileThunk).toHaveBeenCalledWith({ avatar: file });
  expect(addToast).toHaveBeenCalledWith({ message: 'Profile photo updated.', type: 'success' });
});

it('refuses a photo that is still too large after downscaling', async () => {
  (prepareAvatarUpload as jest.Mock).mockResolvedValueOnce({
    size: 3 * 1024 * 1024,
  } as File);
  const { container } = render(<ProfilePanel />);

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['png'], 'big.png', { type: 'image/png' })] },
  });

  expect(await screen.findByRole('alert')).toHaveTextContent('That photo is too large.');
  expect(dispatchMock).not.toHaveBeenCalled();
});

it('shows the name the server normalized, not the text that was typed', async () => {
  dispatchMock.mockResolvedValueOnce({
    type: 'auth/updateProfile/fulfilled',
    payload: { user: { ...user, displayName: 'Ada Lovelace' }, sessionId: 0 },
  });
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  const input = screen.getByLabelText('Display name');
  await typed.clear(input);
  await typed.type(input, 'Ada   Lovelace');
  await typed.tab();

  await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
});

it('drops the local preview when the upload is refused', async () => {
  dispatchMock.mockResolvedValueOnce({
    type: 'auth/updateProfile/rejected',
    payload: "We couldn't read that image.",
  });
  const { container } = render(<ProfilePanel />);

  const file = new File(['png'], 'portrait.png', { type: 'image/png' });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't read that image.");
  // The refused bytes must not keep outranking the stored photo.
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  expect(container.querySelector('img')).toBeNull();
});

it('releases the preview object URL when the panel unmounts mid-upload', async () => {
  // The upload is still in flight, so the preview is what the user is looking at.
  dispatchMock.mockReturnValue(new Promise(() => {}));
  const { container, unmount } = render(<ProfilePanel />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['png'], 'portrait.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

  unmount();

  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});

it('ignores a change event with no file picked', async () => {
  const { container } = render(<ProfilePanel />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;

  fireEvent.change(input, { target: { files: [] } });

  expect(prepareAvatarUpload).not.toHaveBeenCalled();
  expect(dispatchMock).not.toHaveBeenCalled();
});

it('restores the confirmed name when the field is emptied', async () => {
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  const input = screen.getByLabelText('Display name');
  await typed.clear(input);
  await typed.tab();

  expect(dispatchMock).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
});

it('does not save an unchanged name', async () => {
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  const input = screen.getByLabelText('Display name');
  await typed.click(input);
  await typed.tab();

  expect(dispatchMock).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
});

it('opens the file picker from the avatar button', async () => {
  const typed = userEvent.setup();
  const { container } = render(<ProfilePanel />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const clickSpy = jest.spyOn(input, 'click').mockImplementation(() => {});

  await typed.click(screen.getByRole('button', { name: 'Change profile photo' }));

  expect(clickSpy).toHaveBeenCalled();
});

it('commits the name on Enter', async () => {
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  const input = screen.getByLabelText('Display name');
  await typed.clear(input);
  await typed.type(input, 'Ada L{Enter}');

  await waitFor(() => expect(updateProfileThunk).toHaveBeenCalledWith({ displayName: 'Ada L' }));
});

it('keeps the photo when its removal is refused', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: { ...user, avatarUrl: '/api/v1/users/user-1/avatar?v=abc123' },
    isAuthenticated: true,
    isInitializing: false,
  });
  dispatchMock.mockResolvedValueOnce({
    type: 'auth/updateProfile/rejected',
    payload: 'Something went wrong.',
  });
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  await typed.click(screen.getByRole('button', { name: 'Remove' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
  // Removal only disappears once the store stops reporting a photo.
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  expect(addToast).not.toHaveBeenCalled();
});

it('offers removal only when there is a photo', async () => {
  render(<ProfilePanel />);

  expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
});

it('removes the photo and updates the account', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: { ...user, avatarUrl: '/api/v1/users/user-1/avatar?v=abc123' },
    isAuthenticated: true,
    isInitializing: false,
  });
  const typed = userEvent.setup();
  render(<ProfilePanel />);

  await typed.click(screen.getByRole('button', { name: 'Remove' }));

  await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
  expect(updateProfileThunk).toHaveBeenCalledWith({ removeAvatar: true });
});
