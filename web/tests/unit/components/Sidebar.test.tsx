import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../../../components/Sidebar';
import { useLocalDocuments } from '../../../hooks/useLocalDocuments.hook';
import { documentService } from '../../../services/document.service';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useTheme } from '../../../hooks/useTheme.hook';
import * as Y from 'yjs';

jest.mock('../../../hooks/useLocalDocuments.hook');
jest.mock('next/navigation');
jest.mock('../../../services/document.service');
jest.mock('../../../hooks/useAuth.hook');
jest.mock('../../../hooks/useTheme.hook');
jest.mock('../../../components/SettingsModal', () => ({
  SettingsModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-modal">
      <button onClick={onClose}>Close Settings</button>
    </div>
  ),
}));

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockLogout = jest.fn();
const mockOnOpenAuth = jest.fn();

const mockDocs = [
  {
    id: 'id-1',
    meta: { title: 'Doc 1', updatedAt: '2024-01-01T10:00:00Z', createdAt: '2024-01-01T10:00:00Z' },
  },
  {
    id: 'id-2',
    meta: {
      title: 'Untitled',
      updatedAt: '2024-01-01T11:00:00Z',
      createdAt: '2024-01-01T10:00:00Z',
    },
  },
];

function setupDefault() {
  (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  (useParams as jest.Mock).mockReturnValue({ id: 'id-1' });
  (useLocalDocuments as jest.Mock).mockReturnValue({
    documents: mockDocs,
    isLoading: false,
    refresh: mockRefresh,
  });
  (useTheme as jest.Mock).mockReturnValue({ resolvedTheme: 'light' });
  (useAuth as jest.Mock).mockReturnValue({
    user: null,
    isAuthenticated: false,
    logout: mockLogout,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefault();
});

it('renders the document list', () => {
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  expect(screen.getByRole('button', { name: /Doc 1/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Untitled/i })).toBeInTheDocument();
});

it('navigates to the selected document', async () => {
  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  await user.click(screen.getByRole('button', { name: /Untitled/i }));
  expect(mockPush).toHaveBeenCalledWith('/doc/id-2');
});

it('creates a new document and navigates to it', async () => {
  const user = userEvent.setup();
  const mockYdoc = new Y.Doc();
  (documentService.createDocument as jest.Mock).mockResolvedValue({
    ydoc: mockYdoc,
    meta: { title: 'Untitled', createdAt: '...', updatedAt: '...' },
  });
  (documentService.saveDocument as jest.Mock).mockResolvedValue(undefined);

  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  await user.click(screen.getByRole('button', { name: /New document/i }));

  await waitFor(() => {
    expect(documentService.createDocument).toHaveBeenCalled();
    expect(documentService.saveDocument).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/\/doc\/.+/));
  });
});

it('collapses and expands the document list', async () => {
  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /Private/i }));
  expect(screen.queryByRole('button', { name: /Doc 1/i })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Private/i }));
  expect(screen.getByRole('button', { name: /Doc 1/i })).toBeInTheDocument();
});

it('calls onOpenAuth when "Log in" is selected from the account menu', async () => {
  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  await user.click(screen.getByRole('button', { name: /Guest User/i }));
  await user.click(screen.getByRole('menuitem', { name: /Log in/i }));
  expect(mockOnOpenAuth).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('calls logout when "Log out" is selected from the account menu', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    logout: mockLogout,
  });
  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  await user.click(screen.getByRole('button', { name: /Alice/i }));
  await user.click(screen.getByRole('menuitem', { name: /Log out/i }));
  expect(mockLogout).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('opens the settings modal when "Settings" is selected from the account menu', async () => {
  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  await user.click(screen.getByRole('button', { name: /Guest User/i }));
  await user.click(screen.getByRole('menuitem', { name: /Settings/i }));
  expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('closes the account menu when Escape is pressed', async () => {
  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  await user.click(screen.getByRole('button', { name: /Guest User/i }));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
