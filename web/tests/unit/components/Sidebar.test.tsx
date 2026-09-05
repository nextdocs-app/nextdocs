import { act, render as baseRender, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import sidebarReducer from '../../../stores/sidebar/sidebar.slice';
import sidebarTreeReducer from '../../../stores/sidebarTree/sidebarTree.slice';
import sharedTreeReducer from '../../../stores/sharedTree/sharedTree.slice';
import authReducer from '../../../stores/auth/auth.slice';
import documentListReducer from '../../../stores/documentList/documentList.slice';
import uiReducer from '../../../stores/ui/ui.slice';
import userEvent from '@testing-library/user-event';
import Sidebar from '../../../components/sidebar';
import { useDocumentList } from '../../../hooks/useDocumentList.hook';
import { documentService } from '../../../services/document.service';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useTheme } from '../../../hooks/useTheme.hook';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '../../../lib/offline-navigation.util';
import { resolveRootDocumentId } from '../../../lib/root-document.util';
import * as Y from 'yjs';

const mockTreeNodes = {
  'id-1': {
    id: 'id-1',
    title: 'Doc 1',
    parentId: null,
    orderKey: 'a0',
    hasChildren: false,
    effectiveAccessLevel: 'OWNER' as const,
    isExpanded: false,
    isLoading: false,
    children: [],
    childrenLoaded: true,
    createdAt: '2024-01-01T10:00:00Z',
    updatedAt: '2024-01-01T10:00:00Z',
  },
  'id-2': {
    id: 'id-2',
    title: 'Untitled',
    parentId: null,
    orderKey: 'a1',
    hasChildren: false,
    effectiveAccessLevel: 'OWNER' as const,
    isExpanded: false,
    isLoading: false,
    children: [],
    childrenLoaded: true,
    createdAt: '2024-01-01T10:00:00Z',
    updatedAt: '2024-01-01T11:00:00Z',
  },
};

const render = (
  ui: React.ReactElement,
  store: unknown = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      auth: authReducer,
      ui: uiReducer,
      documentList: documentListReducer,
    },
    preloadedState: {
      sidebarTree: {
        nodes: mockTreeNodes,
        rootIds: ['id-1', 'id-2'],
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
    },
  }),
  options?: Parameters<typeof baseRender>[1]
) => {
  return baseRender(ui, {
    wrapper: ({ children }) => (
      <Provider store={store as ReturnType<typeof configureStore>}>{children}</Provider>
    ),
    ...options,
  });
};

jest.mock('../../../hooks/useDocumentList.hook');
jest.mock('next/navigation');
jest.mock('../../../services/document.service');
jest.mock('../../../hooks/useAuth.hook');
jest.mock('../../../hooks/useTheme.hook');
jest.mock('../../../lib/root-document.util', () => ({
  resolveRootDocumentId: jest.fn(),
}));
jest.mock('../../../components/SettingsModal', () => ({
  SettingsModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-modal">
      <button onClick={onClose}>Close Settings</button>
    </div>
  ),
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRefresh = jest.fn();
const mockShowAllDocuments = jest.fn();
const mockShowAllSharedDocuments = jest.fn();
const mockLoadMore = jest.fn();
const mockLoadMoreSharedDocuments = jest.fn();
const mockShowTrashDocuments = jest.fn();
const mockLoadMoreTrashDocuments = jest.fn();
const mockRefreshTrash = jest.fn();
const mockLogout = jest.fn();

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
  (useRouter as jest.Mock).mockReturnValue({ push: mockPush, replace: mockReplace });
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
  (resolveRootDocumentId as jest.Mock).mockResolvedValue('resolved-root-id');
  if (documentService.getAllDocumentsMeta) {
    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue(
      mockDocs.map((d) => ({ id: d.id, meta: d.meta }))
    );
  }
  if (documentService.listRootTreeNodes) {
    (documentService.listRootTreeNodes as jest.Mock).mockResolvedValue({
      items: [],
      hasMore: false,
      page: 0,
    });
  }
  if (documentService.listChildTreeNodes) {
    (documentService.listChildTreeNodes as jest.Mock).mockResolvedValue({
      items: [],
      hasMore: false,
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefault();
});

it('renders the document list', () => {
  render(<Sidebar />);
  expect(screen.getByRole('button', { name: /Doc 1/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Untitled/i })).toBeInTheDocument();
});

it('navigates to the selected document', async () => {
  const user = userEvent.setup();
  render(<Sidebar />);
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
    render(<Sidebar />);
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
  render(<Sidebar />);

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

  render(<Sidebar />);
  const newDocumentButtons = screen.getAllByRole('button', { name: /New document/i });
  await user.click(newDocumentButtons[0]);

  await waitFor(() => {
    expect(documentService.createDocument).toHaveBeenCalled();
    expect(documentService.saveDocument).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/\/doc\/.+/));
  });
});

it('collapses and expands the document list', async () => {
  const user = userEvent.setup();
  render(<Sidebar />);

  await user.click(screen.getByRole('button', { name: /Private/i }));
  expect(screen.queryByRole('button', { name: /Doc 1/i })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Private/i }));
  expect(screen.getByRole('button', { name: /Doc 1/i })).toBeInTheDocument();
});

it('dispatches auth modal open action when "Log in" is selected from the account menu', async () => {
  const store = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      ui: uiReducer,
    },
  });
  const dispatchSpy = jest.spyOn(store, 'dispatch');
  const user = userEvent.setup();
  render(<Sidebar />, store);
  await user.click(screen.getByRole('button', { name: /Guest User/i }));
  await user.click(screen.getByRole('menuitem', { name: /Log in/i }));
  expect(dispatchSpy).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'ui/setAuthModalOpen', payload: true })
  );
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
  render(<Sidebar />);
  await user.click(screen.getByRole('button', { name: /Alice/i }));
  await user.click(screen.getByRole('menuitem', { name: /Log out/i }));
  expect(mockLogout).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(resolveRootDocumentId).toHaveBeenCalledWith({
      isAuthenticated: false,
      accessToken: null,
      excludedDocumentIds: undefined,
    });
  });
  expect(mockReplace).toHaveBeenCalledWith('/doc/resolved-root-id');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('opens the settings modal when "Settings" is selected from the account menu', async () => {
  const user = userEvent.setup();
  render(<Sidebar />);
  await user.click(screen.getByRole('button', { name: /Guest User/i }));
  await user.click(screen.getByRole('menuitem', { name: /Settings/i }));
  expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('closes the account menu when Escape is pressed', async () => {
  const user = userEvent.setup();
  render(<Sidebar />);
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

  render(<Sidebar />);
  await user.click(screen.getByRole('button', { name: /Search Documents/i }));

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

  render(<Sidebar />);

  await user.click(screen.getByRole('button', { name: /Search Documents/i }));

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
  (documentService.listRootTreeNodes as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
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

  render(
    <Sidebar />,
    configureStore({
      reducer: {
        sidebar: sidebarReducer,
        sidebarTree: sidebarTreeReducer,
        sharedTree: sharedTreeReducer,
        auth: authReducer,
        ui: uiReducer,
      },
      preloadedState: {
        sidebarTree: {
          nodes: mockTreeNodes,
          rootIds: ['id-1', 'id-2'],
          isRootLoading: true,
          rootHasMore: false,
          rootPage: 0,
        },
        auth: {
          user: null,
          accessToken: 'test-token',
          expiresAt: null,
          lastAuthAction: null,
          isLoading: false,
          isInitializing: false,
          error: null,
        },
      },
    })
  );

  await user.click(screen.getByRole('button', { name: /Search Documents/i }));

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
    sharedDocuments: Array.from({ length: 8 }, (_, i) => ({
      id: `shared-collab-${i + 1}`,
      relationship: 'collaborator' as const,
      meta: {
        title: `Collaborator Shared Doc ${i + 1}`,
        updatedAt: '2024-01-01T11:00:00Z',
        createdAt: '2024-01-01T10:00:00Z',
      },
    })),
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

  const user = userEvent.setup();
  render(<Sidebar />);

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
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `shared-filler-${i + 1}`,
        relationship: 'collaborator' as const,
        meta: {
          title: `Shared Filler Doc ${i + 1}`,
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      })),
    ],
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
  (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(<Sidebar />);

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
  render(<Sidebar />);

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
  render(<Sidebar />);

  await user.click(screen.getByRole('button', { name: /Document actions for Doc 1/i }));
  await user.click(screen.getByRole('menuitem', { name: /Move to Trash/i }));

  await waitFor(() => {
    expect(documentService.moveCloudDocumentToTrash).toHaveBeenCalledWith('id-1', 'token-1');
  });
  expect(resolveRootDocumentId).toHaveBeenCalledWith({
    isAuthenticated: true,
    accessToken: 'token-1',
    excludedDocumentIds: ['id-1'],
  });
  expect(mockReplace).toHaveBeenCalledWith('/doc/resolved-root-id');
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
  render(<Sidebar />);

  await user.click(screen.getByRole('button', { name: /Search Documents/i }));

  const dialog = screen.getByRole('dialog', { name: /Private documents/i });
  await user.click(within(dialog).getByRole('button', { name: /Document actions for Doc 1/i }));
  await user.click(screen.getByRole('menuitem', { name: /Move to Trash/i }));

  await waitFor(() => {
    expect(documentService.moveCloudDocumentToTrash).toHaveBeenCalledWith('id-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockRefreshTrash).toHaveBeenCalled();
});

it('renders private panel with hasMore true when there are fewer than 7 private docs', async () => {
  const sparseNodes = {
    'sparse-1': {
      id: 'sparse-1',
      title: 'Sparse Doc 1',
      parentId: null,
      orderKey: 'a0',
      hasChildren: false,
      effectiveAccessLevel: 'OWNER' as const,
      isExpanded: false,
      isLoading: false,
      children: [],
      childrenLoaded: true,
      createdAt: '2024-01-01T10:00:00Z',
      updatedAt: '2024-01-01T10:00:00Z',
    },
    'sparse-2': {
      id: 'sparse-2',
      title: 'Sparse Doc 2',
      parentId: null,
      orderKey: 'a1',
      hasChildren: false,
      effectiveAccessLevel: 'OWNER' as const,
      isExpanded: false,
      isLoading: false,
      children: [],
      childrenLoaded: true,
      createdAt: '2024-01-01T10:00:00Z',
      updatedAt: '2024-01-01T11:00:00Z',
    },
  };

  const customStore = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      auth: authReducer,
      ui: uiReducer,
      documentList: documentListReducer,
    },
    preloadedState: {
      sidebarTree: {
        nodes: sparseNodes,
        rootIds: ['sparse-1', 'sparse-2'],
        isRootLoading: false,
        rootHasMore: true,
        rootPage: 0,
      },
    },
  });

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
    documents: [],
    sharedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: true,
    isShowingAll: false,
    trashedDocuments: [],
    isTrashLoading: false,
    isTrashLoadingMore: false,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
    {
      id: 'sparse-1',
      meta: {
        title: 'Sparse Doc 1',
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T10:00:00Z',
      },
    },
    {
      id: 'sparse-2',
      meta: {
        title: 'Sparse Doc 2',
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T11:00:00Z',
      },
    },
  ]);

  (documentService.listRootTreeNodes as jest.Mock).mockResolvedValue({
    items: [
      {
        id: 'sparse-1',
        title: 'Sparse Doc 1',
        parentId: null,
        orderKey: 'a0',
        hasChildren: false,
        effectiveAccessLevel: 'OWNER',
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T10:00:00Z',
      },
      {
        id: 'sparse-2',
        title: 'Sparse Doc 2',
        parentId: null,
        orderKey: 'a1',
        hasChildren: false,
        effectiveAccessLevel: 'OWNER',
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T11:00:00Z',
      },
    ],
    hasMore: true,
    page: 0,
  });

  const user = userEvent.setup();
  render(<Sidebar />, customStore);

  await user.click(screen.getByRole('button', { name: /Search Documents/i }));

  const dialog = screen.getByRole('dialog', { name: /Private documents/i });
  expect(dialog).toBeInTheDocument();
  await waitFor(() => {
    expect(within(dialog).getByText('Sparse Doc 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Sparse Doc 2')).toBeInTheDocument();
  });
});

it('moves a child document to trash in shared tree when user has edit access', async () => {
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
  const mockSharedDocs = [
    {
      id: 'shared-root',
      relationship: 'collaborator' as const,
      parentId: null,
      orderKey: 'a0',
      meta: {
        title: 'Shared Root',
        updatedAt: '2024-01-01T10:00:00Z',
        createdAt: '2024-01-01T10:00:00Z',
      },
    },
  ];
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: [],
    sharedDocuments: mockSharedDocs,
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
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });
  (documentService.moveCloudDocumentToTrash as jest.Mock).mockResolvedValue(undefined);

  const customStore = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      auth: authReducer,
      ui: uiReducer,
    },
    preloadedState: {
      sidebar: {
        isCollapsed: false,
        sidebarWidth: 256,
        isPrivateOpen: true,
        isSharedOpen: true,
        panelMode: null,
        searchQuery: '',
        docActionsAnchor: null,
      },
      sharedTree: {
        nodes: {
          'shared-root': {
            id: 'shared-root',
            title: 'Shared Root',
            parentId: null,
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'EDIT' as const,
            isExpanded: true,
            isLoading: false,
            children: ['child-doc-1'],
            childrenLoaded: true,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
          'child-doc-1': {
            id: 'child-doc-1',
            title: 'Child Doc 1',
            parentId: 'shared-root',
            orderKey: 'b0',
            hasChildren: false,
            effectiveAccessLevel: 'EDIT' as const,
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
        },
        rootIds: ['shared-root'],
      },
    },
  });

  const user = userEvent.setup();
  render(<Sidebar />, customStore);

  await user.click(screen.getByRole('button', { name: /Document actions for Child Doc 1/i }));
  await user.click(screen.getByRole('menuitem', { name: /Move to Trash/i }));

  await waitFor(() => {
    expect(documentService.moveCloudDocumentToTrash).toHaveBeenCalledWith('child-doc-1', 'token-1');
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
  render(<Sidebar />);

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
  render(<Sidebar />);

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
  expect(resolveRootDocumentId).toHaveBeenCalledWith({
    isAuthenticated: true,
    accessToken: 'token-1',
    excludedDocumentIds: ['id-1'],
  });
  expect(mockReplace).toHaveBeenCalledWith('/doc/resolved-root-id');
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockRefreshTrash).toHaveBeenCalled();
});

it('shows restore button for child document in trash when trashHasMore is true and parent is not in trash', async () => {
  const trashedChildDoc = {
    id: 'child-trash-id',
    parentId: 'active-parent-id',
    meta: {
      title: 'Trashed Child Doc',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: '2024-01-02T00:00:00.000Z',
    },
  };

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
    trashedDocuments: [trashedChildDoc],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    hasMore: false,
    isShowingAll: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: true,
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
  render(<Sidebar />);

  await user.click(screen.getByRole('button', { name: /Alice/i }));
  await user.click(screen.getByRole('menuitem', { name: /Trash Documents/i }));

  const restoreBtn = screen.getByRole('button', { name: /Restore Trashed Child Doc/i });
  expect(restoreBtn).toBeInTheDocument();
  await user.click(restoreBtn);

  await waitFor(() => {
    expect(documentService.restoreCloudDocumentFromTrash).toHaveBeenCalledWith(
      'child-trash-id',
      'token-1'
    );
  });
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
  render(<Sidebar />);

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
  render(<Sidebar />);

  await user.click(
    screen.getByRole('button', { name: /Document actions for Collaborator Shared Doc/i })
  );
  await user.click(screen.getByRole('menuitem', { name: /Leave shared document/i }));

  await waitFor(() => {
    expect(documentService.leaveSharedDocument).toHaveBeenCalledWith('shared-collab-1', 'token-1');
  });
  expect(mockRefresh).toHaveBeenCalled();
});

it('resolves a replacement document when leaving the active shared document', async () => {
  (useParams as jest.Mock).mockReturnValue({ id: 'shared-collab-1' });
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
  render(<Sidebar />);

  await user.click(
    screen.getByRole('button', { name: /Document actions for Collaborator Shared Doc/i })
  );
  await user.click(screen.getByRole('menuitem', { name: /Leave shared document/i }));

  expect(documentService.leaveSharedDocument).toHaveBeenCalledWith('shared-collab-1', 'token-1');

  await waitFor(() => {
    expect(resolveRootDocumentId).toHaveBeenCalledWith({
      isAuthenticated: true,
      accessToken: 'token-1',
      excludedDocumentIds: ['shared-collab-1'],
    });
    expect(mockReplace).toHaveBeenCalledWith('/doc/resolved-root-id');
  });
});

it('excludes shared documents from the private section', async () => {
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
      { id: 'id-1', relationship: 'owner' as const, parentId: null, meta: mockDocs[0].meta },
    ],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const documentListInitialState = documentListReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      ui: uiReducer,
      documentList: documentListReducer,
    },
    preloadedState: {
      sidebarTree: {
        nodes: mockTreeNodes,
        rootIds: ['id-1', 'id-2'],
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
      documentList: {
        ...documentListInitialState,
        ownerSharedDocuments: [
          { id: 'id-1', relationship: 'owner' as const, parentId: null, meta: mockDocs[0].meta },
        ],
      },
    },
  });

  render(<Sidebar />, store);

  // "Doc 1" is shared by the owner, so it must only appear in the Shared section
  expect(screen.getAllByRole('button', { name: 'Doc 1' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Untitled' })).toBeInTheDocument();
});

it('excludes shared documents from the private documents panel', async () => {
  const user = userEvent.setup();
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
      { id: 'id-1', relationship: 'owner' as const, parentId: null, meta: mockDocs[0].meta },
    ],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const documentListInitialState = documentListReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      ui: uiReducer,
      documentList: documentListReducer,
    },
    preloadedState: {
      sidebarTree: {
        nodes: mockTreeNodes,
        rootIds: ['id-1', 'id-2'],
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
      documentList: {
        ...documentListInitialState,
        ownerSharedDocuments: [
          { id: 'id-1', relationship: 'owner' as const, parentId: null, meta: mockDocs[0].meta },
        ],
      },
    },
  });

  render(<Sidebar />, store);

  await user.click(screen.getByRole('button', { name: /Search Documents/i }));

  const dialog = screen.getByRole('dialog', { name: /Private documents/i });
  // "Doc 1" is shared by the owner, so it must not appear in the private panel
  expect(within(dialog).queryByRole('button', { name: 'Doc 1' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Untitled' })).toBeInTheDocument();
});

it('keeps nested owner-shared documents in the private section under their parent', async () => {
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
        id: 'id-3',
        relationship: 'owner' as const,
        parentId: 'id-1',
        meta: {
          title: 'Nested Shared Doc',
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const nestedTreeNodes = {
    ...mockTreeNodes,
    'id-1': {
      ...mockTreeNodes['id-1'],
      title: 'Parent Doc',
      isExpanded: true,
      hasChildren: true,
      children: ['id-3'],
    },
    'id-3': {
      ...mockTreeNodes['id-1'],
      id: 'id-3',
      title: 'Nested Shared Doc',
      parentId: 'id-1',
      orderKey: 'a0-1',
      children: [],
      hasChildren: false,
    },
  };

  const documentListInitialState = documentListReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      ui: uiReducer,
      documentList: documentListReducer,
    },
    preloadedState: {
      sidebarTree: {
        nodes: nestedTreeNodes,
        rootIds: ['id-1', 'id-2'],
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
      documentList: {
        ...documentListInitialState,
        ownerSharedDocuments: [
          {
            id: 'id-3',
            relationship: 'owner' as const,
            parentId: 'id-1',
            meta: {
              title: 'Nested Shared Doc',
              updatedAt: '2024-01-01T11:00:00Z',
              createdAt: '2024-01-01T10:00:00Z',
            },
          },
        ],
      },
    },
  });

  render(<Sidebar />, store);

  // The nested shared document stays in the Private section under its parent
  // and must NOT be synthesized in the Shared section.
  expect(screen.getAllByRole('button', { name: 'Nested Shared Doc' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Parent Doc' })).toBeInTheDocument();
  expect(screen.getByText('No shared documents')).toBeInTheDocument();
});

it('shows "Show More" in the private section only when more than 7 root documents exist', async () => {
  const user = userEvent.setup();
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const manyRootIds = Array.from({ length: 9 }, (_, i) => `root-${i + 1}`);
  const manyNodes = Object.fromEntries(
    manyRootIds.map((id, i) => [id, { ...mockTreeNodes['id-1'], id, title: `Doc ${i + 1}` }])
  );

  const store = configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      ui: uiReducer,
    },
    preloadedState: {
      sidebarTree: {
        nodes: manyNodes,
        rootIds: manyRootIds,
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
    },
  });

  render(<Sidebar />, store);

  const showMoreButton = await screen.findByRole('button', { name: /Show all documents/i });
  for (let i = 1; i <= 7; i += 1) {
    expect(screen.getByRole('button', { name: `Doc ${i}` })).toBeInTheDocument();
  }
  expect(screen.queryByRole('button', { name: 'Doc 8' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Doc 9' })).not.toBeInTheDocument();
  await user.click(showMoreButton);
  expect(mockShowAllDocuments).toHaveBeenCalledTimes(1);
});

it('does not show "Show More" in the private section when at most 7 root documents exist', () => {
  (useDocumentList as jest.Mock).mockReturnValue({
    documents: mockDocs,
    sharedDocuments: [],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  render(<Sidebar />);

  expect(screen.queryByRole('button', { name: /Show all documents/i })).not.toBeInTheDocument();
});

it('does not show "Show More" in the shared section when at most 7 root documents exist and nothing more is available', () => {
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
        relationship: 'collaborator' as const,
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
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  render(<Sidebar />);

  expect(
    screen.queryByRole('button', { name: /Show all shared documents/i })
  ).not.toBeInTheDocument();
});

it('renders the "Add a document inside" button for a collaborator document with EDIT access', () => {
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
    documents: [],
    sharedDocuments: [
      {
        id: 'collab-edit-doc',
        relationship: 'collaborator' as const,
        accessLevel: 'EDIT' as const,
        parentId: null,
        meta: {
          title: 'Collab Edit Doc',
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const customStore = configureStore({
    reducer: {
      auth: authReducer,
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      ui: uiReducer,
    },
    preloadedState: {
      sharedTree: {
        nodes: {
          'collab-edit-doc': {
            id: 'collab-edit-doc',
            title: 'Collab Edit Doc',
            parentId: null,
            orderKey: 'shared:collab-edit-doc',
            hasChildren: false,
            effectiveAccessLevel: 'EDIT' as const,
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T11:00:00Z',
          },
        },
        rootIds: ['collab-edit-doc'],
      },
    },
  });

  render(<Sidebar />, customStore);

  expect(screen.getByRole('button', { name: /Add a document inside/i })).toBeInTheDocument();
});

it('does not render the "Add a document inside" button for a collaborator document with VIEW access', () => {
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
    documents: [],
    sharedDocuments: [
      {
        id: 'collab-view-doc',
        relationship: 'collaborator' as const,
        accessLevel: 'VIEW' as const,
        parentId: null,
        meta: {
          title: 'Collab View Doc',
          updatedAt: '2024-01-01T11:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ],
    trashedDocuments: [],
    isLoading: false,
    isSharedLoading: false,
    isLoadingMore: false,
    isSharedLoadingMore: false,
    hasMore: false,
    sharedHasMore: false,
    isShowingAll: false,
    isShowingAllShared: false,
    isTrashLoading: false,
    isTrashLoadingMore: false,
    trashHasMore: false,
    refresh: mockRefresh,
    refreshTrash: mockRefreshTrash,
    showAllDocuments: mockShowAllDocuments,
    showAllSharedDocuments: mockShowAllSharedDocuments,
    showTrashDocuments: mockShowTrashDocuments,
    loadMore: mockLoadMore,
    loadMoreSharedDocuments: mockLoadMoreSharedDocuments,
    loadMoreTrashDocuments: mockLoadMoreTrashDocuments,
  });

  const customStore = configureStore({
    reducer: {
      auth: authReducer,
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      ui: uiReducer,
    },
    preloadedState: {
      sharedTree: {
        nodes: {
          'collab-view-doc': {
            id: 'collab-view-doc',
            title: 'Collab View Doc',
            parentId: null,
            orderKey: 'shared:collab-view-doc',
            hasChildren: false,
            effectiveAccessLevel: 'VIEW' as const,
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T11:00:00Z',
          },
        },
        rootIds: ['collab-view-doc'],
      },
    },
  });

  render(<Sidebar />, customStore);

  expect(screen.queryByRole('button', { name: /Add a document inside/i })).not.toBeInTheDocument();
});
