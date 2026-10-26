import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from '../../../../components/auth/LoginScreen';
import { authApiService } from '../../../../services/auth.service';
import { hardNavigate, hardReplace } from '../../../../lib/navigation.util';

jest.mock('../../../../services/auth.service', () => ({
  authApiService: {
    refresh: jest.fn(),
    login: jest.fn(),
    getInstanceStatus: jest.fn(),
  },
}));

jest.mock('../../../../lib/navigation.util', () => ({
  hardNavigate: jest.fn(),
  hardReplace: jest.fn(),
}));

const mockRefresh = authApiService.refresh as jest.Mock;
const mockLogin = authApiService.login as jest.Mock;
const mockGetInstanceStatus = authApiService.getInstanceStatus as jest.Mock;

async function renderLogin(next?: string) {
  render(<LoginScreen next={next} />);
  return screen.findByLabelText('Email');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockRejectedValue(new Error('No session'));
  mockGetInstanceStatus.mockResolvedValue({ initialized: true });
});

it('shows the form once the session pre-check fails', async () => {
  await renderLogin();

  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(hardReplace).not.toHaveBeenCalled();
});

it('lets the user reveal and hide the password', async () => {
  const user = userEvent.setup();
  await renderLogin();

  const password = screen.getByLabelText('Password');
  expect(password).toHaveAttribute('type', 'password');
  expect(password).toHaveAttribute('placeholder', 'Enter your password');

  await user.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');

  await user.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
});

it('redirects an existing session to the requested page', async () => {
  mockRefresh.mockResolvedValue({});

  render(<LoginScreen next="/doc/shared-doc" />);

  await waitFor(() => expect(hardReplace).toHaveBeenCalledWith('/doc/shared-doc'));
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  expect(mockGetInstanceStatus).not.toHaveBeenCalled();
});

it('sends an uninitialized instance to the bootstrap page', async () => {
  mockGetInstanceStatus.mockResolvedValue({ initialized: false });

  render(<LoginScreen />);

  await waitFor(() => expect(hardReplace).toHaveBeenCalledWith('/join'));
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
});

it('still shows the form when the instance status probe fails', async () => {
  mockGetInstanceStatus.mockRejectedValue(new Error('Network down'));

  await renderLogin();

  expect(hardReplace).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});

it('signs in and performs a full navigation to the requested page', async () => {
  mockLogin.mockResolvedValue({});
  const user = userEvent.setup();
  await renderLogin('/doc/shared-doc');

  await user.type(screen.getByLabelText('Email'), 'user@example.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  await waitFor(() =>
    expect(mockLogin).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'password123',
    })
  );
  expect(hardNavigate).toHaveBeenCalledWith('/doc/shared-doc');
});

it('ignores an unsafe next target and lands on the home route', async () => {
  mockLogin.mockResolvedValue({});
  const user = userEvent.setup();
  await renderLogin('//evil.example/phish');

  await user.type(screen.getByLabelText('Email'), 'user@example.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/'));
});

it('shows the API error and stays on the page when sign-in fails', async () => {
  mockLogin.mockRejectedValue(new Error('Invalid credentials'));
  const user = userEvent.setup();
  await renderLogin();

  await user.type(screen.getByLabelText('Email'), 'user@example.com');
  await user.type(screen.getByLabelText('Password'), 'wrong');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  expect(hardNavigate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
});

it('lands home when next points back at the sign-in page', async () => {
  mockRefresh.mockResolvedValue({});

  render(<LoginScreen next="/login?next=/doc/abc" />);

  await waitFor(() => expect(hardReplace).toHaveBeenCalledWith('/'));
});

it('does not offer in-app signup or OAuth', async () => {
  await renderLogin();

  expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /continue with/i })).not.toBeInTheDocument();
  expect(screen.getByText(/ask a workspace admin for an invite/i)).toBeInTheDocument();
});
