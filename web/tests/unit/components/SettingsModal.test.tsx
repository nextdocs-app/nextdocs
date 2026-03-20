import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '../../../components/SettingsModal';
import { useTheme } from '../../../hooks/useTheme.hook';

jest.mock('../../../hooks/useTheme.hook', () => ({ useTheme: jest.fn() }));

const mockSetTheme = jest.fn();
const mockOnClose = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useTheme as jest.Mock).mockReturnValue({ theme: 'system', setTheme: mockSetTheme });
});

it('renders a theme option for each available choice', () => {
  render(<SettingsModal onClose={mockOnClose} />);
  expect(screen.getByRole('button', { name: /System/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Light/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Dark/i })).toBeInTheDocument();
});

it('calls setTheme with the selected value when a theme option is clicked', async () => {
  const user = userEvent.setup();
  render(<SettingsModal onClose={mockOnClose} />);
  await user.click(screen.getByRole('button', { name: /Dark/i }));
  expect(mockSetTheme).toHaveBeenCalledWith('dark');
});

it('calls onClose when the Escape key is pressed', async () => {
  const user = userEvent.setup();
  render(<SettingsModal onClose={mockOnClose} />);
  await user.keyboard('{Escape}');
  expect(mockOnClose).toHaveBeenCalled();
});

it('calls onClose when the close button is clicked', async () => {
  const user = userEvent.setup();
  render(<SettingsModal onClose={mockOnClose} />);
  await user.click(screen.getByLabelText('Close settings'));
  expect(mockOnClose).toHaveBeenCalled();
});
