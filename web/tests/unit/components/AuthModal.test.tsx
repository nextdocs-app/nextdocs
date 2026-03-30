import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthModal } from '../../../components/AuthModal';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useAppDispatch } from '../../../stores/hooks';

jest.mock('../../../stores/hooks', () => ({ useAppDispatch: jest.fn() }));
jest.mock('../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../stores/auth/auth.slice', () => ({
  clearError: () => ({ type: 'auth/clearError' }),
}));

const mockDispatch = jest.fn();
const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockOnClose = jest.fn();

function setupAuth(overrides: Partial<{ isLoading: boolean; error: string | null }> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    login: mockLogin,
    register: mockRegister,
    isLoading: false,
    error: null,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAppDispatch).mockReturnValue(mockDispatch);
  setupAuth();
});

it('shows the login form by default', () => {
  render(<AuthModal onClose={mockOnClose} />);
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Display Name')).not.toBeInTheDocument();
});

it('switches to signup mode when the user clicks "Create one"', async () => {
  const user = userEvent.setup();
  render(<AuthModal onClose={mockOnClose} />);
  await user.click(screen.getByRole('button', { name: 'Create one' }));
  expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
  expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
});

it('submits login credentials to the auth service', async () => {
  mockLogin.mockReturnValue({ unwrap: () => Promise.resolve() });
  const user = userEvent.setup();
  render(<AuthModal onClose={mockOnClose} />);
  await user.type(screen.getByLabelText('Email'), 'user@example.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(mockLogin).toHaveBeenCalledWith({ email: 'user@example.com', password: 'password123' })
  );
});

it('calls onClose after a successful login', async () => {
  mockLogin.mockReturnValue({ unwrap: () => Promise.resolve() });
  const user = userEvent.setup();
  render(<AuthModal onClose={mockOnClose} />);
  await user.type(screen.getByLabelText('Email'), 'user@example.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
});

it('stays open when login returns a rejected action', async () => {
  mockLogin.mockReturnValue({ unwrap: () => Promise.reject(new Error('rejected')) });
  const user = userEvent.setup();
  render(<AuthModal onClose={mockOnClose} />);
  await user.type(screen.getByLabelText('Email'), 'user@example.com');
  await user.type(screen.getByLabelText('Password'), 'wrong');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mockLogin).toHaveBeenCalled());
  expect(mockOnClose).not.toHaveBeenCalled();
});

it('submits registration credentials including the display name', async () => {
  mockRegister.mockReturnValue({ unwrap: () => Promise.resolve() });
  const user = userEvent.setup();
  render(<AuthModal onClose={mockOnClose} />);
  await user.click(screen.getByRole('button', { name: 'Create one' }));
  await user.type(screen.getByLabelText('Display Name'), 'Alice');
  await user.type(screen.getByLabelText('Email'), 'alice@example.com');
  await user.type(screen.getByLabelText('Password'), 'securepass');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() =>
    expect(mockRegister).toHaveBeenCalledWith({
      email: 'alice@example.com',
      displayName: 'Alice',
      password: 'securepass',
    })
  );
  await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
});

it('displays the error message from the auth state', () => {
  setupAuth({ error: 'Invalid credentials' });
  render(<AuthModal onClose={mockOnClose} />);
  expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
});

it('calls onClose when the Escape key is pressed', async () => {
  const user = userEvent.setup();
  render(<AuthModal onClose={mockOnClose} />);
  await user.keyboard('{Escape}');
  expect(mockOnClose).toHaveBeenCalled();
});

it('keeps input focus when rerendered with a new onClose callback', async () => {
  const user = userEvent.setup();
  const onCloseA = jest.fn();
  const onCloseB = jest.fn();
  const { rerender } = render(<AuthModal onClose={onCloseA} />);

  const emailInput = screen.getByLabelText('Email');
  await user.click(emailInput);
  expect(emailInput).toHaveFocus();

  rerender(<AuthModal onClose={onCloseB} />);
  expect(emailInput).toHaveFocus();

  await user.type(emailInput, 'u');
  expect(emailInput).toHaveValue('u');
  expect(emailInput).toHaveFocus();
});
