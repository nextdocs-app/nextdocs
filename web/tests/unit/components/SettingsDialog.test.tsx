import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsDialog } from '../../../components/settings/SettingsDialog';
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

const mockSetTheme = jest.fn();
const mockOnClose = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useTheme as jest.Mock).mockReturnValue({ theme: 'system', setTheme: mockSetTheme });
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

it('opens on Preferences with an Account navigation', () => {
  render(<SettingsDialog onClose={mockOnClose} />);

  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Preferences' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preferences' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

it('lists the Workspace group for a signed-in member', () => {
  render(<SettingsDialog onClose={mockOnClose} />);

  expect(screen.getByText('Workspace')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'People' })).toBeInTheDocument();
});

it('opens the General page from the Workspace group', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  await user.click(screen.getByRole('button', { name: 'General' }));

  expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Workspace general panel')).toBeInTheDocument();
});

it('opens the People page from the Workspace group', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  await user.click(screen.getByRole('button', { name: 'People' }));

  expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Workspace people panel')).toBeInTheDocument();
});

it('hides workspace pages from guests', () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: null,
    isAuthenticated: false,
    isInitializing: false,
    accessToken: null,
  });
  render(<SettingsDialog onClose={mockOnClose} />);

  expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'People' })).not.toBeInTheDocument();
  expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preferences' })).toBeInTheDocument();
});

it('renders the three theme choices and applies the selected one', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Light' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();

  await user.click(screen.getByRole('radio', { name: 'Dark' }));
  expect(mockSetTheme).toHaveBeenCalledWith('dark');
});

it('switches to the Profile page and shows the signed-in account', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  await user.click(screen.getByRole('button', { name: 'Profile' }));

  expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Profile photo')).toBeInTheDocument();
  expect(screen.getByText('Display name')).toBeInTheDocument();
  expect(screen.getByText('Email')).toBeInTheDocument();
  expect(screen.getByText('santhosh@example.com')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Santhosh Kumar')).toBeInTheDocument();
});

it('renders the display name input as disabled while profile edits are read-only', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  await user.click(screen.getByRole('button', { name: 'Profile' }));

  const input = screen.getByDisplayValue('Santhosh Kumar');
  expect(input).toBeDisabled();
});

it('shows the guest state on the Profile page', async () => {
  const user = userEvent.setup();
  (useAuth as jest.Mock).mockReturnValue({
    user: null,
    isAuthenticated: false,
    isInitializing: false,
  });
  render(<SettingsDialog onClose={mockOnClose} />);

  await user.click(screen.getByRole('button', { name: 'Profile' }));

  expect(screen.getByText('Not signed in')).toBeInTheDocument();
  expect(screen.queryByText('Display name')).not.toBeInTheDocument();
});

it('calls onClose when the Escape key is pressed', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  await user.keyboard('{Escape}');
  expect(mockOnClose).toHaveBeenCalled();
});

it('calls onClose when the close button is clicked', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  await user.click(screen.getByLabelText('Close settings'));
  expect(mockOnClose).toHaveBeenCalled();
});

it('starts with focus on the close button', () => {
  render(<SettingsDialog onClose={mockOnClose} />);

  expect(screen.getByLabelText('Close settings')).toHaveFocus();
});

it('moves Tab focus from the last element back to the first', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  const dialog = screen.getByRole('dialog');
  const focusableElements = getFocusableElements(dialog);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  lastElement.focus();
  await user.tab();

  expect(firstElement).toHaveFocus();
});

it('moves Shift+Tab focus from the first element to the last', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  const dialog = screen.getByRole('dialog');
  const focusableElements = getFocusableElements(dialog);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  firstElement.focus();
  await user.tab({ shift: true });

  expect(lastElement).toHaveFocus();
});

it('treats the dialog surface as the start and end of the focus trap', async () => {
  const user = userEvent.setup();
  render(<SettingsDialog onClose={mockOnClose} />);

  const dialog = screen.getByRole('dialog');
  const focusableElements = getFocusableElements(dialog);

  dialog.focus();
  await user.tab({ shift: true });
  expect(focusableElements[focusableElements.length - 1]).toHaveFocus();

  dialog.focus();
  await user.tab();
  expect(focusableElements[0]).toHaveFocus();
});

it('closes on a backdrop press but not on a press inside the dialog', () => {
  render(<SettingsDialog onClose={mockOnClose} />);

  const dialog = screen.getByRole('dialog');
  const backdrop = dialog.parentElement as HTMLElement;

  fireEvent.mouseDown(dialog);
  expect(mockOnClose).not.toHaveBeenCalled();

  fireEvent.mouseDown(backdrop);
  expect(mockOnClose).toHaveBeenCalledTimes(1);
});

it('restores focus to the persistent opener on unmount', () => {
  const opener = document.createElement('button');
  opener.textContent = 'Account';
  document.body.appendChild(opener);
  opener.focus();

  const { unmount } = render(
    <SettingsDialog onClose={mockOnClose} returnFocusRef={{ current: opener }} />
  );
  expect(screen.getByLabelText('Close settings')).toHaveFocus();

  unmount();
  expect(opener).toHaveFocus();

  opener.remove();
});

it('ignores Escape while an IME composition is active', () => {
  render(<SettingsDialog onClose={mockOnClose} />);

  fireEvent.keyDown(document, { key: 'Escape', isComposing: true });

  expect(mockOnClose).not.toHaveBeenCalled();
});
