import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { SpacesSection } from '@/components/sidebar/SpacesSection';
import authReducer from '@/stores/auth/auth.slice';
import spaceTreeReducer from '@/stores/spaceTree/spaceTree.slice';
import toastsReducer from '@/stores/toasts/toasts.slice';
import { documentService } from '@/services/document.service';
import { spaceApiService } from '@/services/space.service';
import type { Space } from '@/types/space.types';
import type { TreeNode } from '@/types/tree.types';

jest.mock('../../../../services/space.service', () => ({
  spaceApiService: { list: jest.fn() },
}));

jest.mock('../../../../hooks/useMediaQuery.hook', () => ({
  useIsMobileLayout: () => false,
}));

jest.mock('../../../../components/settings/workspace/SpaceSettingsModal', () => ({
  SpaceSettingsModal: ({ initialTab }: { initialTab?: 'general' | 'members' }) => (
    <div data-testid="space-settings-modal" data-tab={initialTab ?? 'general'} />
  ),
}));

jest.mock('../../../../services/document.service', () => ({
  documentService: {
    createDocument: jest.fn(),
    saveDocument: jest.fn().mockResolvedValue(undefined),
    createCloudDocument: jest.fn(),
    listSpaceRootTreeNodes: jest.fn(),
    listChildTreeNodes: jest.fn(),
    moveDocument: jest.fn(),
    deleteDocument: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedSpaceService = spaceApiService as jest.Mocked<typeof spaceApiService>;
const mockedDocumentService = documentService as jest.Mocked<typeof documentService>;

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: 'space-1',
    name: 'Team',
    icon: null,
    accessMode: 'CUSTOM',
    everyoneAccessLevel: 'VIEW',
    myAccessLevel: 'EDIT',
    canAdminister: true,
    memberCount: 2,
    pageCount: 1,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function treePage(items: TreeNode[]) {
  return {
    items,
    page: 0,
    size: 100,
    totalElements: items.length,
    totalPages: 1,
    hasMore: false,
  };
}

function renderSection(spaceOrSpaces: Space | Space[] = makeSpace()) {
  const spaces = Array.isArray(spaceOrSpaces) ? spaceOrSpaces : [spaceOrSpaces];
  mockedSpaceService.list.mockResolvedValue(spaces);
  mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValue(
    treePage([
      {
        id: 'doc-1',
        title: 'Roadmap',
        parentId: null,
        orderKey: 'a0',
        hasChildren: true,
        effectiveAccessLevel: 'EDIT',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        icon: null,
      },
    ])
  );
  mockedDocumentService.createDocument.mockResolvedValue({
    ydoc: {},
    meta: {
      title: 'Untitled',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      createdBy: null,
    },
  } as never);
  mockedDocumentService.createCloudDocument.mockImplementation(
    async (_token, id, title) =>
      ({
        id,
        ydoc: {},
        meta: {
          title,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      }) as never
  );

  const onSelectDocument = jest.fn();
  const authState = {
    ...authReducer(undefined, { type: '@@init' }),
    accessToken: 'token-1',
    user: {
      id: 'user-1',
      displayName: 'Alice',
      email: 'a@b.com',
      avatarUrl: null,
      emailVerified: false,
    },
  };
  const store = configureStore({
    reducer: {
      auth: authReducer,
      spaceTree: spaceTreeReducer,
      toasts: toastsReducer,
    },
    preloadedState: { auth: authState },
  });

  const { container } = render(
    <Provider store={store}>
      <SpacesSection
        accessToken="token-1"
        activeDocId=""
        isOpen
        onToggle={jest.fn()}
        onSelectDocument={onSelectDocument}
        selfId="user-1"
        theme="light"
        sidebarRef={{ current: null }}
        docActionsAnchor={null}
        onToggleDocumentActions={jest.fn()}
      />
    </Provider>
  );

  return { onSelectDocument, store, container };
}

describe('SpacesSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the caret on the space row and reveals documents under a spine', async () => {
    const user = userEvent.setup();
    renderSection();

    const row = await screen.findByRole('button', { name: 'Team space' });
    expect(row.querySelector('[data-space-caret="space-1"]')).not.toBeNull();
    expect(document.querySelector('[data-space-spine="space-1"]')).toBeNull();

    await user.click(row);

    expect(await screen.findByRole('button', { name: 'Roadmap' })).toBeInTheDocument();
    expect(document.querySelector('[data-space-spine="space-1"]')).not.toBeNull();
    expect(row.querySelector('[data-space-caret="space-1"] svg')?.getAttribute('class')).toContain(
      'rotate-90'
    );
  });

  it('opens a document from the space tree', async () => {
    const user = userEvent.setup();
    const { onSelectDocument } = renderSection();

    await user.click(await screen.findByRole('button', { name: 'Team space' }));
    await user.click(await screen.findByRole('button', { name: 'Roadmap' }));

    expect(onSelectDocument).toHaveBeenCalledWith('doc-1');
  });

  it('files a new root document into the space', async () => {
    const user = userEvent.setup();
    const { onSelectDocument } = renderSection();

    await user.click(await screen.findByRole('button', { name: 'New document in Team' }));

    await waitFor(() => expect(mockedDocumentService.createCloudDocument).toHaveBeenCalled());
    const args = mockedDocumentService.createCloudDocument.mock.calls[0];
    expect(args[5]).toBeNull();
    expect(args[8]).toBe('space-1');
    expect(onSelectDocument).toHaveBeenCalledWith(args[1]);
  });

  it('activates the nested action button without toggling the space row', async () => {
    const user = userEvent.setup();
    renderSection();

    const row = await screen.findByRole('button', { name: 'Team space' });
    screen.getByRole('button', { name: 'Team options' }).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: 'Space settings' })).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(mockedDocumentService.listSpaceRootTreeNodes).not.toHaveBeenCalled();
  });

  it('creates a sub-document under a document of the space', async () => {
    const user = userEvent.setup();
    const { onSelectDocument } = renderSection();

    await user.click(await screen.findByRole('button', { name: 'Team space' }));
    await user.click(await screen.findByRole('button', { name: 'Add a document inside' }));

    await waitFor(() => expect(mockedDocumentService.createCloudDocument).toHaveBeenCalled());
    const args = mockedDocumentService.createCloudDocument.mock.calls[0];
    expect(args[5]).toBe('doc-1');
    expect(args[8]).toBeNull();
    expect(onSelectDocument).toHaveBeenCalledWith(args[1]);
  });

  it('does not offer document creation to a viewer', async () => {
    renderSection(makeSpace({ myAccessLevel: 'VIEW', canAdminister: false }));

    await screen.findByRole('button', { name: 'Team space' });
    expect(screen.queryByRole('button', { name: 'New document in Team' })).toBeNull();
  });

  it('offers members instead of document creation in the space menu', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Team options' }));

    expect(screen.getByRole('menuitem', { name: 'Manage members' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Space settings' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'New document' })).toBeNull();
  });

  it('opens space settings on the members tab from the space menu', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Team options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Manage members' }));

    expect(await screen.findByTestId('space-settings-modal')).toHaveAttribute(
      'data-tab',
      'members'
    );
  });

  it('labels the member entry as view-only without administer rights', async () => {
    const user = userEvent.setup();
    renderSection(makeSpace({ canAdminister: false, myAccessLevel: 'VIEW' }));

    await user.click(await screen.findByRole('button', { name: 'Team options' }));

    expect(screen.getByRole('menuitem', { name: 'View members' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Manage members' })).toBeNull();
  });

  it('does not keep action buttons visible when row is focused after click', async () => {
    const user = userEvent.setup();
    const { container } = renderSection();

    const row = await screen.findByRole('button', { name: 'Team space' });
    await user.click(row);

    const actionsContainer = container.querySelector(
      '[data-space-actions-root="space-1"]'
    )?.parentElement;
    expect(actionsContainer).not.toBeNull();
    expect(actionsContainer?.className).toContain('opacity-0');
    expect(actionsContainer?.className).not.toContain('group-focus-within/space:opacity-100');
  });

  it('renders a placeholder tile background when space has no icon', async () => {
    const { container } = renderSection(makeSpace({ icon: null }));

    await screen.findByRole('button', { name: 'Team space' });
    const tile = container.querySelector('.bg-\\[var\\(--nd-placeholder-bg\\)\\]');
    expect(tile).toBeInTheDocument();
  });

  it('renders a colored builtin space icon with matching tinted background', async () => {
    const { container } = renderSection(
      makeSpace({ icon: { type: 'builtin', value: 'folder', color: 'blue' } })
    );

    await screen.findByRole('button', { name: 'Team space' });
    const tile = container.querySelector('span[style*="color-mix"]');
    expect(tile).toBeInTheDocument();
    expect(tile).toHaveStyle({
      backgroundColor: 'color-mix(in srgb, var(--nd-icon-color-blue) 18%, transparent)',
      color: 'var(--nd-icon-color-blue)',
    });
  });

  it('indents the space documents container past the spine line so hover accents start after the line', async () => {
    const user = userEvent.setup();
    const { container } = renderSection();

    await user.click(await screen.findByRole('button', { name: 'Team space' }));

    const pageButton = await screen.findByRole('button', { name: 'Roadmap' });
    const spine = container.querySelector('[data-space-spine="space-1"]');
    expect(spine).not.toBeNull();
    expect(spine?.className).toContain('left-[20px]');

    const pagesContainer = spine?.nextElementSibling;
    expect(pagesContainer?.className).toContain('pl-6');
    expect(pageButton).toHaveStyle({ paddingLeft: '8px' });
  });

  it('does not display spaces in the sidebar if the user is not a member (workspace admin)', async () => {
    const memberSpace = makeSpace({ id: 'space-1', name: 'My Team', myAccessLevel: 'EDIT' });
    const adminOnlySpace = makeSpace({
      id: 'space-2',
      name: 'Confidential Finance',
      myAccessLevel: null,
      canAdminister: true,
    });

    renderSection([memberSpace, adminOnlySpace]);

    expect(await screen.findByRole('button', { name: 'My Team space' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confidential Finance space' })).toBeNull();
  });

  it('hides the entire spaces section when the user is not part of any space', async () => {
    const adminOnlySpace = makeSpace({
      id: 'space-2',
      name: 'Confidential Finance',
      myAccessLevel: null,
      canAdminister: true,
    });

    renderSection([adminOnlySpace]);

    await waitFor(() => {
      expect(mockedSpaceService.list).toHaveBeenCalled();
    });

    expect(screen.queryByLabelText('Spaces')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confidential Finance space' })).toBeNull();
  });
});
