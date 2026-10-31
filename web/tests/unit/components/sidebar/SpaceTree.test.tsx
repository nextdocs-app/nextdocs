import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/stores/auth/auth.slice';
import spaceTreeReducer from '@/stores/spaceTree/spaceTree.slice';
import toastsReducer from '@/stores/toasts/toasts.slice';
import { SpaceTree, canDropWithinSpace } from '@/components/sidebar/SpaceTree';
import { documentService } from '@/services/document.service';
import type { TreeApi } from '@/components/sidebar/SidebarTreeDndContext';
import type { SidebarTreeNode, TreeNode } from '@/types/tree.types';

let capturedTreeApi: TreeApi | null = null;
jest.mock('../../../../components/sidebar/SidebarTreeDndContext', () => {
  const actual = jest.requireActual('../../../../components/sidebar/SidebarTreeDndContext');
  return {
    ...actual,
    SidebarTreeDndContext: ({
      treeApi,
      children,
    }: {
      treeApi: TreeApi;
      children: React.ReactNode;
    }) => {
      capturedTreeApi = treeApi;
      return (
        <actual.SidebarTreeDndContext treeApi={treeApi}>{children}</actual.SidebarTreeDndContext>
      );
    },
  };
});

jest.mock('../../../../services/document.service', () => ({
  documentService: {
    moveDocument: jest.fn(),
    listChildTreeNodes: jest.fn(),
  },
}));

const mockedDocumentService = documentService as jest.Mocked<typeof documentService>;

function node(id: string, parentId: string | null = null): SidebarTreeNode {
  return {
    id,
    title: id,
    parentId,
    orderKey: 'a0',
    hasChildren: false,
    effectiveAccessLevel: 'EDIT',
    icon: null,
    isExpanded: false,
    isLoading: false,
    children: [],
    childrenLoaded: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const nodes: Record<string, SidebarTreeNode> = {
  root: node('root'),
  otherRoot: node('otherRoot'),
  child: node('child', 'root'),
};

describe('canDropWithinSpace', () => {
  it('lets a space root reorder against other roots', () => {
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'otherRoot', zone: 'top' })).toBe(true);
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'otherRoot', zone: 'bottom' })).toBe(true);
  });

  it('lets a space root move inside another root or nested document', () => {
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'otherRoot', zone: 'mid' })).toBe(true);
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'otherRoot', zone: 'empty' })).toBe(true);
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'child', zone: 'mid' })).toBe(true);
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'child', zone: 'top' })).toBe(true);
  });

  it('lets a nested document move inside another document in the space', () => {
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'otherRoot', zone: 'mid' })).toBe(true);
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'otherRoot', zone: 'empty' })).toBe(true);
  });

  it('prevents a nested document from being dropped at the space root level', () => {
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'otherRoot', zone: 'top' })).toBe(false);
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'otherRoot', zone: 'bottom' })).toBe(false);
  });

  it('refuses dropping a document onto itself', () => {
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'root', zone: 'mid' })).toBe(false);
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'child', zone: 'mid' })).toBe(false);
  });

  it('refuses a drop it cannot resolve', () => {
    expect(canDropWithinSpace(nodes, 'missing', { nodeId: 'root', zone: 'mid' })).toBe(false);
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'missing', zone: 'mid' })).toBe(false);
  });
});

describe('SpaceTree component', () => {
  function makeStore() {
    return configureStore({
      reducer: {
        auth: authReducer,
        spaceTree: spaceTreeReducer,
        toasts: toastsReducer,
      },
      preloadedState: {
        auth: {
          user: {
            id: 'user-1',
            email: 'test@example.com',
            displayName: 'Test',
            avatarUrl: null,
            emailVerified: true,
          },
          accessToken: 'test-token',
          expiresAt: Date.now() + 60_000,
          sessionId: 1,
          isInitializing: false,
        },
      },
    });
  }

  function treeNode(data: Partial<TreeNode> & { id: string; title: string }): TreeNode {
    return {
      parentId: null,
      orderKey: 'a0',
      hasChildren: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      effectiveAccessLevel: 'EDIT',
      ...data,
    };
  }

  beforeEach(() => {
    capturedTreeApi = null;
    jest.clearAllMocks();
  });

  it('renders root nodes and exposes treeApi with drop policies allowing intra-space nesting', () => {
    const store = makeStore();
    const treeState = {
      nodes: {
        root: node('root'),
        otherRoot: node('otherRoot'),
        child: node('child', 'root'),
      },
      rootIds: ['root', 'otherRoot'],
      isRootLoading: false,
    };

    render(
      <Provider store={store}>
        <SpaceTree
          spaceId="space-1"
          tree={treeState}
          activeDocId="root"
          onSelectDocument={jest.fn()}
          onCreateChild={jest.fn()}
          docActionsAnchor={null}
          onToggleDocumentActions={jest.fn()}
          isActionsEnabled={true}
        />
      </Provider>
    );

    expect(capturedTreeApi).not.toBeNull();
    // Verify resolveDrop allows moving root into otherRoot
    expect(capturedTreeApi!.resolveDrop!('root', { nodeId: 'otherRoot', zone: 'mid' })).toBe(true);
    // Verify canPlaceAtRoot allows root but not child
    expect(capturedTreeApi!.canPlaceAtRoot('root')).toBe(true);
    expect(capturedTreeApi!.canPlaceAtRoot('child')).toBe(false);
  });

  it('moves a root document inside another document and fetches unloaded children', async () => {
    const store = makeStore();
    const targetParent = node('target');
    targetParent.hasChildren = true;
    targetParent.childrenLoaded = false;

    const movingDoc = node('doc-to-move');

    const treeState = {
      nodes: {
        target: targetParent,
        'doc-to-move': movingDoc,
      },
      rootIds: ['target', 'doc-to-move'],
      isRootLoading: false,
    };

    mockedDocumentService.moveDocument.mockResolvedValueOnce(
      treeNode({ id: 'doc-to-move', title: 'Moved Doc', parentId: 'target', orderKey: 'a0' })
    );
    mockedDocumentService.listChildTreeNodes.mockResolvedValueOnce({
      items: [
        treeNode({ id: 'doc-to-move', title: 'Moved Doc', parentId: 'target', orderKey: 'a0' }),
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 50,
      hasMore: false,
    });

    render(
      <Provider store={store}>
        <SpaceTree
          spaceId="space-1"
          tree={treeState}
          activeDocId=""
          onSelectDocument={jest.fn()}
          onCreateChild={jest.fn()}
          docActionsAnchor={null}
          onToggleDocumentActions={jest.fn()}
          isActionsEnabled={true}
        />
      </Provider>
    );

    expect(capturedTreeApi).not.toBeNull();

    capturedTreeApi!.moveDocument({
      documentId: 'doc-to-move',
      newParentId: 'target',
      prevSiblingId: null,
      nextSiblingId: null,
    });

    await waitFor(() => {
      expect(mockedDocumentService.moveDocument).toHaveBeenCalledWith(
        'doc-to-move',
        { newParentId: 'target', prevSiblingId: null, nextSiblingId: null },
        'test-token'
      );
    });

    await waitFor(() => {
      expect(mockedDocumentService.listChildTreeNodes).toHaveBeenCalledWith(
        'target',
        'test-token',
        0
      );
    });
  });

  it('moves a root document inside another document without refetching if children are already loaded', async () => {
    const store = makeStore();
    const targetParent = node('target');
    targetParent.hasChildren = true;
    targetParent.childrenLoaded = true;
    targetParent.children = ['existing-child'];

    const movingDoc = node('doc-to-move');

    const treeState = {
      nodes: {
        target: targetParent,
        'existing-child': node('existing-child', 'target'),
        'doc-to-move': movingDoc,
      },
      rootIds: ['target', 'doc-to-move'],
      isRootLoading: false,
    };

    mockedDocumentService.moveDocument.mockResolvedValueOnce(
      treeNode({ id: 'doc-to-move', title: 'Moved Doc', parentId: 'target', orderKey: 'a1' })
    );

    render(
      <Provider store={store}>
        <SpaceTree
          spaceId="space-1"
          tree={treeState}
          activeDocId=""
          onSelectDocument={jest.fn()}
          onCreateChild={jest.fn()}
          docActionsAnchor={null}
          onToggleDocumentActions={jest.fn()}
          isActionsEnabled={true}
        />
      </Provider>
    );

    capturedTreeApi!.moveDocument({
      documentId: 'doc-to-move',
      newParentId: 'target',
      prevSiblingId: 'existing-child',
      nextSiblingId: null,
    });

    await waitFor(() => {
      expect(mockedDocumentService.moveDocument).toHaveBeenCalledWith(
        'doc-to-move',
        { newParentId: 'target', prevSiblingId: 'existing-child', nextSiblingId: null },
        'test-token'
      );
    });

    expect(mockedDocumentService.listChildTreeNodes).not.toHaveBeenCalled();
  });
});
