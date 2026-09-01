import { render as baseRender, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { DocToolbar } from '../../../components/DocToolbar';
import sidebarReducer from '../../../stores/sidebar/sidebar.slice';
import sidebarTreeReducer from '../../../stores/sidebarTree/sidebarTree.slice';
import sharedTreeReducer from '../../../stores/sharedTree/sharedTree.slice';
import authReducer from '../../../stores/auth/auth.slice';
import { documentService } from '../../../services/document.service';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '../../../lib/offline-navigation.util';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

jest.mock('../../../components/SharePanel', () => ({
  SharePanel: () => <div data-testid="share-panel" />,
}));

jest.mock('../../../services/document.service', () => ({
  documentService: {
    getDocumentBreadcrumbs: jest.fn().mockResolvedValue([]),
  },
}));

function createTestStore(preloadedState?: Record<string, unknown>) {
  return configureStore({
    reducer: {
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      auth: authReducer,
    },
    preloadedState,
  });
}

function renderWithStore(ui: React.ReactElement, preloadedState?: Record<string, unknown>) {
  const store = createTestStore(preloadedState);
  return {
    ...baseRender(<Provider store={store}>{ui}</Provider>),
    store,
  };
}

describe('DocToolbar trash notice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the restore action for users who can manage the trashed document', () => {
    const onRestore = jest.fn();

    renderWithStore(
      <DocToolbar
        documentId="doc-1"
        isShareEnabled={false}
        isOffline={false}
        showTrashNotice
        canManageTrash
        onRestore={onRestore}
      />
    );

    expect(screen.getByText(/This document is in the trash\./)).toBeInTheDocument();
    const restoreButton = screen.getByRole('button', { name: 'Restore' });
    expect(restoreButton).toBeInTheDocument();

    fireEvent.click(restoreButton);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('shows the read-only notice without a restore action for viewers and commenters', () => {
    renderWithStore(
      <DocToolbar
        documentId="doc-1"
        isShareEnabled={false}
        isOffline={false}
        showTrashNotice
        canManageTrash={false}
        onRestore={jest.fn()}
      />
    );

    expect(
      screen.getByText(/read-only access and can view it, but only people with edit access/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows the trash notice without a restore action when canManageTrash is true but onRestore is undefined', () => {
    renderWithStore(
      <DocToolbar
        documentId="doc-1"
        isShareEnabled={false}
        isOffline={false}
        showTrashNotice
        canManageTrash
      />
    );

    expect(screen.getByText(/This document is in the trash\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows no trash notice when the document is not trashed', () => {
    renderWithStore(<DocToolbar documentId="doc-1" isShareEnabled={false} isOffline={false} />);

    expect(screen.queryByText(/This document is in the/)).not.toBeInTheDocument();
  });
});

describe('DocToolbar hierarchy breadcrumbs (Notion-style)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a single root document title when there are no ancestors', () => {
    renderWithStore(
      <DocToolbar
        documentId="doc-1"
        documentTitle="My Solo Doc"
        isShareEnabled={false}
        isOffline={false}
      />
    );

    const nav = screen.getByRole('navigation', { name: 'Document hierarchy' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText('My Solo Doc')).toBeInTheDocument();
  });

  it('renders multi-level hierarchy from local Redux tree nodes', () => {
    const preloadedState = {
      sidebarTree: {
        nodes: {
          'root-doc': {
            id: 'root-doc',
            title: 'Engineering Wiki',
            parentId: null,
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER' as const,
            isExpanded: true,
            isLoading: false,
            children: ['parent-doc'],
            childrenLoaded: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          'parent-doc': {
            id: 'parent-doc',
            title: 'Frontend Architecture',
            parentId: 'root-doc',
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER' as const,
            isExpanded: true,
            isLoading: false,
            children: ['doc-child'],
            childrenLoaded: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          'doc-child': {
            id: 'doc-child',
            title: 'Toolbar Component',
            parentId: 'parent-doc',
            orderKey: 'a0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER' as const,
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
        rootIds: ['root-doc'],
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
    };

    renderWithStore(
      <DocToolbar
        documentId="doc-child"
        documentTitle="Toolbar Component"
        isShareEnabled={false}
        isOffline={false}
      />,
      preloadedState
    );

    expect(screen.getByText('Engineering Wiki')).toBeInTheDocument();
    expect(screen.getByText('Frontend Architecture')).toBeInTheDocument();
    expect(screen.getByText('Toolbar Component')).toBeInTheDocument();
  });

  it('allows clicking an ancestor to navigate to that document', async () => {
    const user = userEvent.setup();
    const onNavigateDocument = jest.fn();

    const preloadedState = {
      sidebarTree: {
        nodes: {
          'root-doc': {
            id: 'root-doc',
            title: 'Parent Project',
            parentId: null,
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER' as const,
            isExpanded: true,
            isLoading: false,
            children: ['doc-child'],
            childrenLoaded: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          'doc-child': {
            id: 'doc-child',
            title: 'Current Feature',
            parentId: 'root-doc',
            orderKey: 'a0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER' as const,
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
        rootIds: ['root-doc'],
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
    };

    renderWithStore(
      <DocToolbar
        documentId="doc-child"
        documentTitle="Current Feature"
        onNavigateDocument={onNavigateDocument}
        isShareEnabled={false}
        isOffline={false}
      />,
      preloadedState
    );

    const ancestorButton = screen.getByRole('button', { name: /Parent Project/i });
    expect(ancestorButton).toBeInTheDocument();

    await user.click(ancestorButton);
    expect(onNavigateDocument).toHaveBeenCalledWith('root-doc');
  });

  it('navigates with router.push when onNavigateDocument is not provided', async () => {
    const user = userEvent.setup();

    const preloadedState = {
      sidebarTree: {
        nodes: {
          'root-doc': {
            id: 'root-doc',
            title: 'Main Folder',
            parentId: null,
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER' as const,
            isExpanded: true,
            isLoading: false,
            children: ['doc-child'],
            childrenLoaded: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          'doc-child': {
            id: 'doc-child',
            title: 'Sub Page',
            parentId: 'root-doc',
            orderKey: 'a0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER' as const,
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
        rootIds: ['root-doc'],
        isRootLoading: false,
        rootHasMore: false,
        rootPage: 0,
      },
    };

    renderWithStore(
      <DocToolbar
        documentId="doc-child"
        documentTitle="Sub Page"
        isShareEnabled={false}
        isOffline={false}
      />,
      preloadedState
    );

    const ancestorButton = screen.getByRole('button', { name: /Main Folder/i });
    await user.click(ancestorButton);

    expect(mockPush).toHaveBeenCalledWith('/doc/root-doc');
  });

  it('collapses deep hierarchies (>3 levels) into an ellipsis menu', async () => {
    const user = userEvent.setup();
    const onNavigateDocument = jest.fn();

    (documentService.getDocumentBreadcrumbs as jest.Mock).mockResolvedValue([
      { id: 'doc-1', title: 'Workspace Root', parentId: null },
      { id: 'doc-2', title: 'Department', parentId: 'doc-1' },
      { id: 'doc-3', title: 'Project X', parentId: 'doc-2' },
      { id: 'doc-4', title: 'Specifications', parentId: 'doc-3' },
      { id: 'doc-5', title: 'Current Page', parentId: 'doc-4' },
    ]);

    renderWithStore(
      <DocToolbar
        documentId="doc-5"
        documentTitle="Current Page"
        onNavigateDocument={onNavigateDocument}
        isShareEnabled={false}
        isOffline={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace Root')).toBeInTheDocument();
      expect(screen.getByText('Specifications')).toBeInTheDocument();
      expect(screen.getByText('Current Page')).toBeInTheDocument();
    });

    // The intermediate levels should be collapsed behind the ellipsis button
    const ellipsisButton = screen.getByRole('button', {
      name: 'Show intermediate parent documents',
    });
    expect(ellipsisButton).toBeInTheDocument();

    // Click ellipsis to open menu
    await user.click(ellipsisButton);

    expect(screen.getByRole('menuitem', { name: /Department/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Project X/i })).toBeInTheDocument();

    // Click intermediate document in menu
    await user.click(screen.getByRole('menuitem', { name: /Project X/i }));
    expect(onNavigateDocument).toHaveBeenCalledWith('doc-3');
  });

  it('updates the active document title reactively in breadcrumbs', () => {
    const { rerender } = renderWithStore(
      <DocToolbar
        documentId="doc-1"
        documentTitle="Original Title"
        isShareEnabled={false}
        isOffline={false}
      />
    );

    expect(screen.getByText('Original Title')).toBeInTheDocument();

    rerender(
      <Provider store={createTestStore()}>
        <DocToolbar
          documentId="doc-1"
          documentTitle="Updated Live Title"
          isShareEnabled={false}
          isOffline={false}
        />
      </Provider>
    );

    expect(screen.getByText('Updated Live Title')).toBeInTheDocument();
  });

  it('does not display private parent documents when collaborator only has access to child', async () => {
    // Server returns only the accessible portion of the hierarchy
    (documentService.getDocumentBreadcrumbs as jest.Mock).mockResolvedValue([
      { id: 'doc-shared-child', title: 'Shared Child Doc', parentId: null },
    ]);

    renderWithStore(
      <DocToolbar
        documentId="doc-shared-child"
        documentTitle="Shared Child Doc"
        isShareEnabled={false}
        isOffline={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Shared Child Doc')).toBeInTheDocument();
    });

    expect(screen.queryByText('Secret Org Root')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret Parent Folder')).not.toBeInTheDocument();
  });

  it('displays hierarchy starting from shared ancestor when collaborator has access from parent level', async () => {
    // Collaborator has access from Project level down to Task
    (documentService.getDocumentBreadcrumbs as jest.Mock).mockResolvedValue([
      { id: 'doc-shared-parent', title: 'Shared Project', parentId: null },
      { id: 'doc-child-task', title: 'Task Details', parentId: 'doc-shared-parent' },
    ]);

    renderWithStore(
      <DocToolbar
        documentId="doc-child-task"
        documentTitle="Task Details"
        isShareEnabled={false}
        isOffline={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Shared Project')).toBeInTheDocument();
      expect(screen.getByText('Task Details')).toBeInTheDocument();
    });

    // Unshared higher-level root must not be visible
    expect(screen.queryByText('Secret Company Root')).not.toBeInTheDocument();
  });

  it('dispatches OFFLINE_DOCUMENT_SELECT_EVENT when navigating in offline mode', async () => {
    const user = userEvent.setup();
    const offlineEventSpy = jest.fn();
    window.addEventListener(OFFLINE_DOCUMENT_SELECT_EVENT, offlineEventSpy);

    (documentService.getDocumentBreadcrumbs as jest.Mock).mockResolvedValue([
      { id: 'doc-offline-parent', title: 'Parent Offline Doc', parentId: null },
      { id: 'doc-offline-child', title: 'Child Offline Doc', parentId: 'doc-offline-parent' },
    ]);

    renderWithStore(
      <DocToolbar
        documentId="doc-offline-child"
        documentTitle="Child Offline Doc"
        isShareEnabled={false}
        isOffline={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Parent Offline Doc')).toBeInTheDocument();
    });

    const parentButton = screen.getByRole('button', { name: /Parent Offline Doc/i });
    await user.click(parentButton);

    expect(offlineEventSpy).toHaveBeenCalledTimes(1);
    expect(offlineEventSpy.mock.calls[0][0].detail).toEqual({ id: 'doc-offline-parent' });
    expect(mockPush).not.toHaveBeenCalled();

    window.removeEventListener(OFFLINE_DOCUMENT_SELECT_EVENT, offlineEventSpy);
  });

  it('falls back gracefully to single document breadcrumb when service rejects with an error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (documentService.getDocumentBreadcrumbs as jest.Mock).mockRejectedValue(
      new Error('403 Forbidden')
    );

    renderWithStore(
      <DocToolbar
        documentId="doc-err"
        documentTitle="Isolated Document"
        isShareEnabled={false}
        isOffline={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Isolated Document')).toBeInTheDocument();
    });

    warnSpy.mockRestore();
  });

  it('renders Open "title" tooltips and aria-labels on ancestor buttons and no tooltip on active page', async () => {
    (documentService.getDocumentBreadcrumbs as jest.Mock).mockResolvedValue([
      { id: 'doc-parent', title: 'Parent Workspace', parentId: null },
      { id: 'doc-current', title: 'Active Page', parentId: 'doc-parent' },
    ]);

    renderWithStore(
      <DocToolbar
        documentId="doc-current"
        documentTitle="Active Page"
        isShareEnabled={false}
        isOffline={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Parent Workspace')).toBeInTheDocument();
      expect(screen.getByText('Active Page')).toBeInTheDocument();
    });

    const parentButton = screen.getByRole('button', { name: 'Open "Parent Workspace"' });
    expect(parentButton).toHaveAttribute('title', 'Open "Parent Workspace"');
    expect(parentButton).toHaveAttribute('aria-label', 'Open "Parent Workspace"');

    const activeItem = screen.getByText('Active Page').closest('span[aria-current="page"]');
    expect(activeItem).toBeInTheDocument();
    expect(activeItem).not.toHaveAttribute('title');
  });
});
