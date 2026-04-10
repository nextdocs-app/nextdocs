import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../../../components/Sidebar';
import { useDocumentList } from '../../../hooks/useDocumentList.hook';
import { documentService } from '../../../services/document.service';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useTheme } from '../../../hooks/useTheme.hook';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '../../../lib/offline-navigation.util';
import * as Y from 'yjs';

jest.mock('../../../hooks/useDocumentList.hook');
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
const mockShowAllDocuments = jest.fn();
const mockShowAllSharedDocuments = jest.fn();
const mockLoadMore = jest.fn();
const mockLoadMoreSharedDocuments = jest.fn();
const mockShowTrashDocuments = jest.fn();
const mockLoadMoreTrashDocuments = jest.fn();
const mockRefreshTrash = jest.fn();
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
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isSharedLoadingMore: false,
    sharedHasMore: false,
    isShowingAllShared: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (useTheme as jest.Mock).mockReturnValue({ resolvedTheme: 'light' });
  (useAuth as jest.Mock).mockReturnValue({
    user: null,
    isAuthenticated: false,
    accessToken: null,
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

it('dispatches offline document select event instead of route navigation when browser is offline', async () => {
  const user = userEvent.setup();
  const dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');
  const originalOnLine = navigator.onLine;

  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: false,
  });

  try {
    render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
    await user.click(screen.getByRole('button', { name: /Untitled/i }));

    expect(mockPush).not.toHaveBeenCalled();
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'nextdocs-open-local-document',
        detail: { id: 'id-2' },
      })
    );
  } finally {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: originalOnLine,
    });
    dispatchEventSpy.mockRestore();
  }
});

it('updates sidebar active focus from offline document selection event without route change', () => {
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  const docOneButton = screen.getByRole('button', { name: /Doc 1/i });
  const docTwoButton = screen.getByRole('button', { name: /Untitled/i });

  expect(docOneButton).toHaveClass('bg-sidebar-accent/70');
  expect(docTwoButton).not.toHaveClass('bg-sidebar-accent/70');

  act(() => {
    window.dispatchEvent(
      new CustomEvent(OFFLINE_DOCUMENT_SELECT_EVENT, {
        detail: { id: 'id-2' },
      })
    );
  });

  expect(docTwoButton).toHaveClass('bg-sidebar-accent/70');
  expect(docOneButton).not.toHaveClass('bg-sidebar-accent/70');
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
    accessToken: 'token-1',
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

it('calls showAllDocuments when "show all documents" is clicked', async () => {
  const user = userEvent.setup();
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: true,
    isShowingAll: false,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: true,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);
  await user.click(screen.getByRole('button', { name: /show all/i }));

  expect(mockShowAllDocuments).toHaveBeenCalledTimes(1);
});

it('opens all documents panel with search and closes with back', async () => {
  const user = userEvent.setup();
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: true,
    isShowingAll: false,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: true,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /show all/i }));

  const dialog = screen.getByRole('dialog', { name: /Private documents/i });
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByPlaceholderText(/Search documents/i)).toBeInTheDocument();

  await user.type(within(dialog).getByPlaceholderText(/Search documents/i), 'Doc 1');
  expect(within(dialog).getByRole('button', { name: /Doc 1/i })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Back/i }));
  expect(screen.queryByRole('dialog', { name: /Private documents/i })).not.toBeInTheDocument();
});

it('renders skeleton rows instead of a loading badge while loading more in the documents panel', async () => {
  const user = userEvent.setup();
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isSharedLoadingMore: false,
    sharedHasMore: false,
    isShowingAllShared: false,
    isLoadingMore: true,
    hasMore: true,
    isShowingAll: true,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: true,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /show all/i }));

  expect(screen.getByRole('dialog', { name: /Private documents/i })).toBeInTheDocument();
  expect(screen.getByTestId('documents-panel-loading-more-skeleton')).toBeInTheDocument();
  expect(screen.queryByText(/Loading more/i)).not.toBeInTheDocument();
});

it('opens shared documents panel from shared section show all', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });

  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [
      {
        id: 'shared-collab-1',
        relationship: 'collaborator',
        meta: {
          title: 'Collaborator Shared Doc',
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ],
    isLoading: false,
    isSharedLoading: false,
    isSharedLoadingMore: false,
    sharedHasMore: true,
    isShowingAllShared: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /show all/i }));

  expect(mockShowAllSharedDocuments).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog', { name: /Shared documents/i })).toBeInTheDocument();
});

it('lets collaborator leave shared document from shared panel row actions menu', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });

  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [
      {
        id: 'shared-collab-1',
        relationship: 'collaborator',
        meta: {
          title: 'Collaborator Shared Doc',
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ],
    isLoading: false,
    isSharedLoading: false,
    isSharedLoadingMore: false,
    sharedHasMore: true,
    isShowingAllShared: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /show all/i }));

  const dialog = screen.getByRole('dialog', { name: /Shared documents/i });
  await user.click(
    within(dialog).getByRole('button', { name: /Document actions for Collaborator Shared Doc/i })
  );
  await user.click(screen.getByRole('menuitem', { name: /Leave shared document/i }));

  await waitFor(() => {
    expect(documentService.leaveSharedDocument).toHaveBeenCalledWith('shared-collab-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
});

it('shows trash option for authenticated user and opens trash panel', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    trashedDocuments: mockDocs,
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /Alice/i }));
  await user.click(screen.getByRole('menuitem', { name: /Trash Documents/i }));

  expect(mockShowTrashDocuments).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog', { name: /Trash documents/i })).toBeInTheDocument();
});

it('moves a document to trash from row actions menu', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });
  (documentService.moveCloudDocumentToTrash as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /Document actions for Doc 1/i }));
  await user.click(screen.getByRole('menuitem', { name: /Move to Trash/i }));

  await waitFor(() => {
    expect(documentService.moveCloudDocumentToTrash).toHaveBeenCalledWith('id-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockRefreshTrash).toHaveBeenCalled();
});

it('moves a document to trash from show all documents panel row actions menu', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: true,
    isShowingAll: false,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: true,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (documentService.moveCloudDocumentToTrash as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /show all/i }));

  const dialog = screen.getByRole('dialog', { name: /Private documents/i });
  await user.click(within(dialog).getByRole('button', { name: /Document actions for Doc 1/i }));
  await user.click(screen.getByRole('menuitem', { name: /Move to Trash/i }));

  await waitFor(() => {
    expect(documentService.moveCloudDocumentToTrash).toHaveBeenCalledWith('id-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockRefreshTrash).toHaveBeenCalled();
});

it('restores a document from trash panel row actions', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    trashedDocuments: mockDocs,
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (documentService.restoreCloudDocumentFromTrash as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /Alice/i }));
  await user.click(screen.getByRole('menuitem', { name: /Trash Documents/i }));
  await user.click(screen.getByRole('button', { name: /Restore Doc 1/i }));

  await waitFor(() => {
    expect(documentService.restoreCloudDocumentFromTrash).toHaveBeenCalledWith('id-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockRefreshTrash).toHaveBeenCalled();
});

it('permanently deletes a document from trash panel after confirmation', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    trashedDocuments: mockDocs,
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (documentService.deleteCloudDocumentPermanently as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /Alice/i }));
  await user.click(screen.getByRole('menuitem', { name: /Trash Documents/i }));
  await user.click(screen.getByRole('button', { name: /Delete permanently Doc 1/i }));

  const confirmationDialog = screen.getByRole('dialog', { name: /Delete permanently\?/i });
  expect(confirmationDialog).toBeInTheDocument();
  await user.click(
    within(confirmationDialog).getByRole('button', { name: /^Delete Permanently$/i })
  );

  await waitFor(() => {
    expect(documentService.deleteCloudDocumentPermanently).toHaveBeenCalledWith('id-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockRefreshTrash).toHaveBeenCalled();
});

it('moves an owner-shared document to trash from shared section row actions menu', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [
      {
        id: 'shared-owner-1',
        relationship: 'owner',
        meta: {
          title: 'Owner Shared Doc',
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (documentService.moveCloudDocumentToTrash as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(screen.getByRole('button', { name: /Document actions for Owner Shared Doc/i }));
  await user.click(screen.getByRole('menuitem', { name: /Move to Trash/i }));

  await waitFor(() => {
    expect(documentService.moveCloudDocumentToTrash).toHaveBeenCalledWith(
      'shared-owner-1',
      'token-1'
    );
  });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockRefreshTrash).toHaveBeenCalled();
});

it('lets collaborator leave shared document from shared section row actions menu', async () => {
  (useAuth as jest.Mock).mockReturnValue({
    user: {
      displayName: 'Alice',
      id: '1',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
    isAuthenticated: true,
    accessToken: 'token-1',
    logout: mockLogout,
  });
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [
      {
        id: 'shared-collab-1',
        relationship: 'collaborator',
        meta: {
          title: 'Collaborator Shared Doc',
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    canShowAll: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar onOpenAuth={mockOnOpenAuth} />);

  await user.click(
    screen.getByRole('button', { name: /Document actions for Collaborator Shared Doc/i })
  );
  await user.click(screen.getByRole('menuitem', { name: /Leave shared document/i }));

  await waitFor(() => {
    expect(documentService.leaveSharedDocument).toHaveBeenCalledWith('shared-collab-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
});
