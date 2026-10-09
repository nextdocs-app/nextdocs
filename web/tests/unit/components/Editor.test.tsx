// Mock BlockNote BEFORE importing Editor
jest.mock('@blocknote/react', () => {
  const actualReact = jest.requireActual<typeof import('react')>('react');
  return {
    useCreateBlockNote: jest.fn((options, deps) => {
      return actualReact.useMemo(
        () => ({
          document: [{ content: [] }],
          focus: jest.fn(),
          mount: jest.fn(),
          unmount: jest.fn(),
          isEditable: true,
          onChange: jest.fn(() => jest.fn()),
        }),
        deps
      );
    }),
    blockTypeSelectItems: jest.fn(() => []),
    getFormattingToolbarItems: jest.fn(() => []),
    useBlockNoteEditor: jest.fn(() => ({
      getExtension: jest.fn(() => undefined),
    })),
    useComponentsContext: jest.fn(() => ({
      FormattingToolbar: {
        Button: () => null,
      },
    })),
    useDictionary: jest.fn(() => ({
      formatting_toolbar: {
        comment: {
          tooltip: 'Comment',
        },
      },
    })),
    FormattingToolbar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    FormattingToolbarController: jest.fn(() => null),
    BasicTextStyleButton: ({ basicTextStyle }: { basicTextStyle: string }) => (
      <button data-test={basicTextStyle} />
    ),
    BlockTypeSelect: () => null,
    TableCellMergeButton: () => null,
    FileCaptionButton: () => null,
    FileReplaceButton: () => null,
    FileRenameButton: () => null,
    FileDeleteButton: () => null,
    FileDownloadButton: () => null,
    FilePreviewButton: () => null,
    TextAlignButton: () => null,
    ColorStyleButton: () => null,
    NestBlockButton: () => null,
    UnnestBlockButton: () => null,
    CreateLinkButton: () => null,
    AddCommentButton: () => null,
    SideMenuController: () => null,
    SuggestionMenuController: jest.fn(() => null),
    FloatingComposerController: () => null,
    FloatingThreadController: jest.fn(() => null),
    getDefaultReactSlashMenuItems: jest.fn(() => []),
    AddBlockButton: () => null,
    DragHandleButton: () => null,
    useExtensionState: jest.fn(),
    // CommentsSidebar runs its hooks even while closed (it renders nothing
    // until it is opened), so it needs the extension and thread stores to exist.
    useExtension: jest.fn(() => ({
      userStore: {
        store: { subscribe: jest.fn(() => () => {}) },
        getUser: jest.fn(),
        loadUsers: jest.fn(async () => {}),
      },
    })),
    useThreads: jest.fn(() => new Map()),
    ThreadsSidebar: () => <div data-testid="threads-sidebar" />,
    createReactBlockSpec: jest.fn((config, implementation) => () => ({
      type: config?.type || 'alert',
      config,
      implementation,
    })),
  };
});

jest.mock('@blocknote/math-block', () => ({
  createReactMathBlockSpec: jest.fn(() => ({ type: 'mathBlock' })),
  createReactInlineMathSpec: jest.fn(() => ({ type: 'math' })),
  getMathBlockTypeSelectItems: jest.fn(() => [
    { name: 'Equation', type: 'mathBlock', icon: () => null },
  ]),
  getMathSlashMenuItems: jest.fn(() => [
    { title: 'Block Equation', group: 'Advanced' },
    { title: 'Inline Equation', group: 'Advanced' },
  ]),
  locales: { en: { block_type_select: { name: 'Equation' } } },
}));

jest.mock('@blocknote/diagram-block', () => ({
  createReactDiagramBlockSpec: jest.fn(() => ({ type: 'diagram' })),
  getDiagramBlockTypeSelectItems: jest.fn(() => [
    { name: 'Diagram', type: 'diagram', icon: () => null },
  ]),
  getDiagramSlashMenuItems: jest.fn(() => [{ title: 'Diagram', group: 'Advanced' }]),
  locales: { en: { block_type_select: { name: 'Diagram' } } },
}));

jest.mock('@blocknote/shadcn', () => ({
  BlockNoteView: jest.fn(() => <div data-testid="blocknote-view" />),
  ShadCNDefaultComponents: {
    DropdownMenu: {
      DropdownMenuTrigger: ({
        children,
        nativeButton: _nativeButton,
        render: _render,
        ...props
      }: React.ComponentPropsWithoutRef<'button'> & {
        nativeButton?: boolean;
        render?: React.ReactNode;
      }) => {
        void _nativeButton;
        void _render;
        return <button {...props}>{children}</button>;
      },
      DropdownMenuContent: ({
        children,
        container: _container,
        ...props
      }: React.ComponentPropsWithoutRef<'div'> & {
        container?: HTMLElement | null;
      }) => {
        void _container;
        return (
          <div data-slot="dropdown-menu-content" {...props}>
            {children}
          </div>
        );
      },
    },
    Popover: {
      PopoverTrigger: ({
        children,
        nativeButton: _nativeButton,
        render: _render,
        ...props
      }: React.ComponentPropsWithoutRef<'button'> & {
        nativeButton?: boolean;
        render?: React.ReactNode;
      }) => {
        void _nativeButton;
        void _render;
        return <button {...props}>{children}</button>;
      },
      PopoverContent: ({
        children,
        container: _container,
        ...props
      }: React.ComponentPropsWithoutRef<'div'> & {
        container?: HTMLElement | null;
      }) => {
        void _container;
        return (
          <div data-slot="popover-content" {...props}>
            {children}
          </div>
        );
      },
    },
    Tooltip: {
      TooltipContent: ({
        children,
        container: _container,
        ...props
      }: React.ComponentPropsWithoutRef<'div'> & {
        container?: HTMLElement | null;
      }) => {
        void _container;
        return (
          <div data-slot="tooltip-content" {...props}>
            {children}
          </div>
        );
      },
    },
  },
}));

jest.mock('@blocknote/core', () => {
  const fallback = {
    BlockNoteSchema: {
      create: jest.fn(() => ({
        extend: jest.fn().mockReturnValue({ isExtendedSchema: true }),
      })),
    },
    createCodeBlockSpec: jest.fn((options) => ({ type: 'codeBlock', options })),
    combineByGroup: jest.fn((base = [], ...others) => [...base, ...others.flat()]),
    defaultProps: {
      textAlignment: { default: 'left', values: ['left', 'center', 'right', 'justify'] },
      textColor: { default: 'default' },
    },
  };
  try {
    return {
      ...jest.requireActual('@blocknote/core'),
      ...fallback,
    };
  } catch {
    // Jest cannot load the real @blocknote/core (ESM via prosemirror-highlight
    // without extra transform), so fall back to the wholesale mock above.
    return fallback;
  }
});

jest.mock('@blocknote/core/comments', () => ({
  CommentsExtension: jest.fn(() => ({})),
  ThreadStoreAuth: class ThreadStoreAuth {},
  DefaultThreadStoreAuth: jest.fn(),
}));

jest.mock('@blocknote/core/extensions', () => ({
  SideMenuExtension: {},
  filterSuggestionItems: jest.fn((items) => items),
}));

jest.mock('@blocknote/core/yjs', () => ({
  YjsThreadStore: jest.fn(),
  withCollaboration: jest.fn((options) => options),
}));

jest.mock('@blocknote/code-block', () => ({
  codeBlockOptions: {
    defaultLanguage: 'javascript',
    supportedLanguages: {
      javascript: { name: 'JavaScript', aliases: ['javascript', 'js'] },
    },
  },
}));

jest.mock('@blocknote/xl-multi-column', () => ({
  withMultiColumn: jest.fn((schema) => schema),
  multiColumnDropCursor: { hooks: {} },
  getMultiColumnSlashMenuItems: jest.fn(() => []),
  locales: { en: { slash_menu: {} } },
}));

jest.mock('../../../components/editor/codeBlockHighlighter', () => ({
  syntaxHighlighter: { key: 'syntaxHighlighter' },
}));

jest.mock('../../../services/document.service', () => ({
  documentService: {
    listCollaborators: jest.fn().mockResolvedValue([]),
    getDocumentBreadcrumbs: jest.fn().mockResolvedValue([]),
  },
}));

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import React from 'react';
import {
  render as baseRender,
  screen,
  fireEvent,
  act,
  cleanup,
  waitFor,
} from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import uiReducer from '../../../stores/ui/ui.slice';
import Editor from '../../../components/editor';
import { useDocument } from '../../../hooks/useDocument.hook';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';
import { useYjsPersistence } from '../../../hooks/useYjsPersistence.hook';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { createCodeBlockSpec } from '@blocknote/core';
import { syntaxHighlighter } from '../../../components/editor/codeBlockHighlighter';
import { MobileFormattingToolbarController } from '../../../components/editor/MobileFormattingToolbar';
import { MobileAddBlockButton } from '../../../components/editor/MobileAddBlockButton';
import { MobileDeleteBlockButton } from '../../../components/editor/MobileDeleteBlockButton';
import { MOBILE_LAYOUT_QUERY, TOUCH_INPUT_QUERY } from '../../../hooks/useMediaQuery.hook';
import {
  attachmentService,
  AttachmentServiceApiError,
  UnsupportedUrlError,
} from '../../../services/attachment.service';
import toastsReducer from '../../../stores/toasts/toasts.slice';
import { CommentsExtension } from '@blocknote/core/comments';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '../../../lib/offline-navigation.util';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { WebsocketProvider } from 'y-websocket';

const render = (
  ui: React.ReactElement,
  store = configureStore({ reducer: { ui: uiReducer } }),
  options?: Parameters<typeof baseRender>[1]
) => {
  return baseRender(ui, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    ...options,
  });
};

// Mock hooks
jest.mock('../../../hooks/useDocument.hook');
jest.mock('../../../hooks/useAuth.hook');
jest.mock('../../../hooks/useNetworkStatus.hook');
jest.mock('../../../hooks/useYjsPersistence.hook');
jest.mock('next/navigation');
jest.mock('../../../hooks/useTheme.hook', () => ({
  useTheme: jest.fn(() => ({ theme: 'system', setTheme: jest.fn(), resolvedTheme: 'light' })),
}));

type EditorViewHandlers = {
  onPointerDownCapture?: (event: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => void;
  onClick?: (event: { target: EventTarget | null }) => void;
  comments?: boolean;
};

/** The props the last render handed to BlockNoteView (whose DOM is mocked). */
function lastBlockNoteViewHandlers(): EditorViewHandlers {
  const mock = BlockNoteView as unknown as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1][0] as EditorViewHandlers;
}

// createCodeBlockSpec is called once at EditorContent module load, before
// beforeEach(jest.clearAllMocks()) wipes mock history. Capture it here.
const capturedCodeBlockOptions = (createCodeBlockSpec as unknown as jest.Mock).mock.calls[0]?.[0];

// jsdom ships no `matchMedia`, which is why the rest of this suite sees a mouse
// and a wide viewport; the touch test defines it for itself only.
function stubTouchInput() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query === TOUCH_INPUT_QUERY,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

function clearTouchInputStub() {
  delete (window as { matchMedia?: unknown }).matchMedia;
}

describe('Editor Component', () => {
  const mockUpdateMeta = jest.fn();
  const mockReplace = jest.fn();
  const mockYdoc = new Y.Doc();
  const mockMeta = {
    title: 'Untitled',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace });
    (useParams as jest.Mock).mockReturnValue({
      id: 'test-doc-id',
    });
    (useSearchParams as jest.Mock).mockReturnValue({
      get: () => null,
      toString: () => '',
    });
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
      user: null,
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: true,
      isOffline: false,
    });
    (useYjsPersistence as jest.Mock).mockReturnValue({
      isSaving: false,
      lastSaved: null,
      pendingEdits: 0,
      hasPendingSync: false,
    });
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: mockMeta,
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    clearTouchInputStub();
  });

  it('should show loading state after delay', async () => {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: null,
      meta: null,
      accessLevel: null,
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: true,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    expect(screen.queryByText(/Loading document.../i)).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText(/Loading document.../i)).toBeInTheDocument();
      },
      { timeout: 500 }
    );
  });

  it('should show error state', () => {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: null,
      meta: null,
      accessLevel: null,
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: new Error('Failed to load'),
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);
    expect(screen.getByText(/Unable to open this document/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
  });

  it('should show restricted access panel state', () => {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: null,
      meta: null,
      accessLevel: null,
      isReadOnly: true,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: {
        kind: 'restricted',
        title: 'Access to this document has been restricted',
        description: 'This document may have been moved to trash.',
        statusCode: 404,
        responseMessage: 'The requested resource was not found.',
      },
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    expect(screen.getByText(/Access to this document has been restricted/i)).toBeInTheDocument();
    expect(screen.getByText(/Response code: 404/i)).toBeInTheDocument();
    expect(screen.queryByTestId('blocknote-view')).not.toBeInTheDocument();
  });

  it('should render title input and auto-focus for new documents', () => {
    render(<Editor />);

    const textarea = screen.getByPlaceholderText(/Untitled/i) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe(''); // "Untitled" is shown as empty with placeholder
    expect(document.activeElement).toBe(textarea);
  });

  it('should update title on change', () => {
    render(<Editor />);

    const textarea = screen.getByPlaceholderText(/Untitled/i);
    fireEvent.change(textarea, { target: { value: 'New Document Title' } });

    expect(mockUpdateMeta).toHaveBeenCalledWith({ title: 'New Document Title' });
  });

  it('should focus editor when Enter is pressed in title', async () => {
    jest.useFakeTimers();
    const mockFocus = jest.fn();
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [] }],
      focus: mockFocus,
    });

    render(<Editor />);

    const textarea = screen.getByPlaceholderText(/Untitled/i);
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Advance timers for the setTimeout in handleKeyDown
    act(() => {
      jest.advanceTimersByTime(50);
    });

    // Should focus editor
    expect(mockFocus).toHaveBeenCalled();
  });

  it('should show editor if document has content', () => {
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [{ type: 'text', text: 'hello' }] }],
      focus: jest.fn(),
    });

    render(<Editor />);

    // Editor should be visible because it has content even if title is "Untitled"
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
  });

  it('should hide editor for new untitled documents and keep it hidden while typing title', () => {
    const mockFocus = jest.fn();
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [] }],
      focus: mockFocus,
    });

    const { rerender } = render(<Editor />);

    // Type a title (re-render with updated meta)
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: { ...mockMeta, title: 'M' },
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    rerender(<Editor />);

    // Editor should still be hidden after typing title
    expect(screen.queryByTestId('blocknote-view')).not.toBeInTheDocument();

    // Press Enter
    const textarea = screen.getByPlaceholderText(/Untitled/i);
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Now it should be visible
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
  });

  it('should replace route when resolved document id differs from route id', () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'route-doc-id' });
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'cloud-doc-1',
      ydoc: mockYdoc,
      meta: mockMeta,
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    expect(mockReplace).toHaveBeenCalledWith('/doc/cloud-doc-1');
  });

  it('should not replace route while offline even if resolved document id differs', () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'route-doc-id' });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'cloud-doc-1',
      ydoc: mockYdoc,
      meta: mockMeta,
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('should switch effective document from offline sidebar selection event', async () => {
    render(<Editor />);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(OFFLINE_DOCUMENT_SELECT_EVENT, {
          detail: { id: 'offline-doc-2' },
        })
      );
    });

    await waitFor(() => {
      expect(useDocument as jest.Mock).toHaveBeenLastCalledWith('offline-doc-2', {
        isSharedDocument: false,
      });
    });
  });

  it('should toggle comments sidebar button state for authenticated users', () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token',
      user: {
        id: 'user-1',
        displayName: 'Jane Doe',
        email: 'jane@example.com',
        avatarUrl: null,
      },
    });

    render(<Editor />);

    const commentsButton = screen.getByRole('button', { name: /open comments sidebar/i });
    expect(commentsButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(commentsButton);
    expect(commentsButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('should render shared guest toolbar notice and open auth modal from CTA', () => {
    (useSearchParams as jest.Mock).mockReturnValue({
      get: (key: string) => {
        if (key === 'share') return '1';
        if (key === 'authRequired') return '1';
        return null;
      },
      toString: () => 'share=1&authRequired=1',
    });

    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title: 'Shared Doc',
      },
      accessLevel: 'VIEW',
      isReadOnly: true,
      isGuestShareLink: true,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    const store = configureStore({
      reducer: {
        ui: uiReducer,
      },
    });
    const dispatchSpy = jest.spyOn(store, 'dispatch');

    render(<Editor />, store);

    expect(screen.getByText(/You are viewing a shared document as a guest\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ui/setAuthModalOpen', payload: true })
    );
  });

  it('shows the guest notice to a comment-level share-link guest', () => {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: { ...mockMeta, title: 'Shared Here' },
      accessLevel: 'COMMENT',
      isReadOnly: true,
      isGuestShareLink: true,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    const store = configureStore({
      reducer: {
        ui: uiReducer,
      },
    });

    render(<Editor />, store);

    // Comment-only guests are still guests: they need the sign-in path as much as
    // a viewer does, and the notice no longer keys off the access level.
    expect(screen.getByText(/You are viewing a shared document as a guest\./i)).toBeInTheDocument();
  });

  it('does not show the guest notice outside a share link', () => {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: { ...mockMeta, title: 'Local Doc' },
      accessLevel: 'EDIT',
      isReadOnly: false,
      isGuestShareLink: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    const store = configureStore({
      reducer: {
        ui: uiReducer,
      },
    });

    render(<Editor />, store);

    expect(
      screen.queryByText(/You are viewing a shared document as a guest\./i)
    ).not.toBeInTheDocument();
  });

  it('shows offline badge when browser is offline even for local guest editing', () => {
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });

    render(<Editor />);

    expect(screen.getByLabelText(/offline sync status/i)).toBeInTheDocument();
  });

  it('does not show offline badge when browser is online but realtime is disconnected', () => {
    jest.useFakeTimers();
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token',
      user: {
        id: 'user-1',
        displayName: 'Jane Doe',
        email: 'jane@example.com',
        avatarUrl: null,
      },
    });
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: mockMeta,
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByLabelText(/offline sync status/i)).not.toBeInTheDocument();
  });

  it('shows pending offline edit count in tooltip', () => {
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });
    (useYjsPersistence as jest.Mock).mockReturnValue({
      isSaving: false,
      lastSaved: null,
      pendingEdits: 3,
      hasPendingSync: true,
    });

    render(<Editor />);

    const offlineBadge = screen.getByLabelText(/offline sync status/i);
    fireEvent.mouseEnter(offlineBadge);

    expect(screen.getByText(/Offline changes/i)).toBeInTheDocument();
    expect(screen.getByText(/3 edits pending sync/i)).toBeInTheDocument();
  });

  it('should render BlockNote in read-only mode for view access', () => {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title: 'Shared read only doc',
      },
      accessLevel: 'VIEW',
      isReadOnly: true,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastCall = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1];
    expect(lastCall[0]).toEqual(
      expect.objectContaining({
        editable: false,
        formattingToolbar: false,
        linkToolbar: false,
        slashMenu: false,
        sideMenu: false,
        filePanel: false,
        tableHandles: false,
        emojiPicker: false,
      })
    );
  });

  it('should keep comments extension enabled for viewers to render commented content', () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token',
      user: {
        id: 'viewer-1',
        displayName: 'Viewer User',
        email: 'viewer@example.com',
        avatarUrl: null,
      },
    });

    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title: 'Commented doc',
      },
      accessLevel: 'VIEW',
      isReadOnly: true,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    expect(
      screen.queryByRole('button', { name: /open comments sidebar/i })
    ).not.toBeInTheDocument();

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];
    expect(lastConfig.extensions).toHaveLength(3);
    expect(CommentsExtension).toHaveBeenCalled();
  });

  it('should initialize BlockNote with custom codeBlock schema', () => {
    render(<Editor />);

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];

    expect(lastConfig.schema).toBeDefined();
    expect(lastConfig.schema).toEqual(expect.objectContaining({ isExtendedSchema: true }));
  });

  it('should initialize BlockNote with advanced table configuration', () => {
    render(<Editor />);

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];

    expect(lastConfig.tables).toEqual({
      splitCells: true,
      cellBackgroundColor: true,
      cellTextColor: true,
      headers: true,
    });
  });

  it('should initialize BlockNote with codeBlock schema and syntax highlighter', () => {
    render(<Editor />);

    // Extended options keep the bundled defaults and add back languages that
    // exist in user documents but are missing from the BlockNote bundle (http).
    expect(capturedCodeBlockOptions?.supportedLanguages).toBeDefined();
    expect(capturedCodeBlockOptions.supportedLanguages.javascript).toEqual(
      expect.objectContaining({ name: 'JavaScript' })
    );
    expect(capturedCodeBlockOptions.supportedLanguages.http).toEqual(
      expect.objectContaining({ name: 'HTTP' })
    );

    // Unknown languages (or "" from a bare ``` + Enter) must never throw
    // `Language <x> is not supported` (upstream TypeCellOS/BlockNote#3005).
    expect('http' in capturedCodeBlockOptions.supportedLanguages).toBe(true);
    expect('definitely-not-a-language' in capturedCodeBlockOptions.supportedLanguages).toBe(true);
    expect('' in capturedCodeBlockOptions.supportedLanguages).toBe(true);

    // hasOwnProperty / getOwnPropertyDescriptor must agree with `in` so a
    // future upstream switch away from `in` still falls back to plain text.
    expect(
      Object.prototype.hasOwnProperty.call(
        capturedCodeBlockOptions.supportedLanguages,
        'definitely-not-a-language'
      )
    ).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(
        capturedCodeBlockOptions.supportedLanguages,
        'definitely-not-a-language'
      )?.value
    ).toEqual(expect.objectContaining({ aliases: [] }));
    expect(Object.hasOwn(capturedCodeBlockOptions.supportedLanguages, '')).toBe(true);

    // Enumeration still only lists real languages for the dropdown.
    expect(Object.keys(capturedCodeBlockOptions.supportedLanguages)).toContain('http');
    expect(Object.keys(capturedCodeBlockOptions.supportedLanguages)).toContain('javascript');
    expect(Object.keys(capturedCodeBlockOptions.supportedLanguages)).not.toContain(
      'definitely-not-a-language'
    );
    expect(Object.keys(capturedCodeBlockOptions.supportedLanguages)).not.toContain('');

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];
    expect(lastConfig.extensions).toContain(syntaxHighlighter);
  });

  it('should preserve selection for first comment click in comment-only mode', () => {
    const mockFocus = jest.fn();
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [] }],
      focus: mockFocus,
      getExtension: jest.fn(() => undefined),
    });

    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title: 'Comment-only document',
      },
      accessLevel: 'COMMENT',
      isReadOnly: true,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastCall = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1];
    const pointerHandler = lastCall[0].onPointerDownCapture as
      ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;

    expect(pointerHandler).toBeDefined();

    const toolbar = document.createElement('div');
    toolbar.className = 'bn-formatting-toolbar';
    const toolbarButton = document.createElement('button');
    toolbar.appendChild(toolbarButton);

    const preventDefault = jest.fn();
    pointerHandler?.({
      target: toolbarButton,
      preventDefault,
    } as unknown as ReactPointerEvent<HTMLDivElement>);

    expect(preventDefault).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  describe('clicking a comment mark', () => {
    const mockBlur = jest.fn();
    const commentsState = { selectedThreadId: undefined as string | undefined };

    function setup() {
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token',
        user: {
          id: 'user-1',
          displayName: 'Jane Doe',
          email: 'jane@example.com',
          avatarUrl: null,
        },
      });
      (useCreateBlockNote as jest.Mock).mockReturnValue({
        // Content, so the editor (and with it BlockNoteView) actually renders.
        document: [{ content: [{ type: 'text', text: 'hello' }] }],
        focus: jest.fn(),
        blur: mockBlur,
        getExtension: jest.fn(() => ({ store: { state: commentsState } })),
      });

      render(<Editor />);

      const commentMark = document.createElement('span');
      commentMark.className = 'bn-thread-mark';

      return { handlers: lastBlockNoteViewHandlers(), commentMark };
    }

    it('drops the editor focus when the click opens a thread', () => {
      const { handlers, commentMark } = setup();

      // Nothing is selected when the finger goes down...
      handlers.onPointerDownCapture?.({ target: commentMark, preventDefault: jest.fn() });
      // ...the comments extension selects its thread on mouseup, which is where
      // its own click handling runs, and the click reaches the container after
      // that. Focus would otherwise stay on the contenteditable with the
      // on-screen keyboard over the thread that was just opened.
      commentsState.selectedThreadId = 'thread-1';
      handlers.onClick?.({ target: commentMark });

      expect(mockBlur).toHaveBeenCalledTimes(1);
    });

    it('keeps the editor focus when the click opens nothing', () => {
      const { handlers, commentMark } = setup();
      const plainText = document.createElement('span');

      // A thread that was already open when the press started: this click is the
      // one that puts the cursor back into the commented text, so the caret it
      // places has to survive.
      commentsState.selectedThreadId = 'thread-1';
      handlers.onPointerDownCapture?.({ target: commentMark, preventDefault: jest.fn() });
      handlers.onClick?.({ target: commentMark });

      // Text that is not commented at all.
      commentsState.selectedThreadId = 'thread-1';
      handlers.onPointerDownCapture?.({ target: plainText, preventDefault: jest.fn() });
      handlers.onClick?.({ target: plainText });

      expect(mockBlur).not.toHaveBeenCalled();
    });
  });

  it('renders the floating thread itself so it can be bounded to the screen', () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token',
      user: {
        id: 'user-1',
        displayName: 'Jane Doe',
        email: 'jane@example.com',
        avatarUrl: null,
      },
    });
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [{ type: 'text', text: 'hello' }] }],
      focus: jest.fn(),
      getExtension: jest.fn(() => undefined),
    });

    render(<Editor />);

    // BlockNote's default comments UI would render its own thread card with its
    // own placement rules, which let a tall thread run off the screen; the card
    // is rendered from EditorContent instead (see comment.utils.ts).
    expect(lastBlockNoteViewHandlers().comments).toBe(false);
  });

  it('should maintain a stable BlockNote editor instance across realtimeProvider, accessLevel, and token updates', () => {
    const mockUseDocument = useDocument as unknown as jest.Mock;
    const mockUseAuth = useAuth as unknown as jest.Mock;
    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;

    mockUseDocument.mockReturnValue({
      documentId: 'doc-stable-1',
      ydoc: mockYdoc,
      awareness: null,
      meta: { id: 'doc-stable-1', title: 'Stable Document', updatedAt: new Date().toISOString() },
      accessLevel: 'VIEW',
      isReadOnly: true,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    const { rerender } = render(<Editor />);
    const initialCallCount = useCreateBlockNoteMock.mock.calls.length;
    expect(initialCallCount).toBeGreaterThan(0);

    // Simulate accessLevel upgrade, token refresh, and realtime provider connection
    mockUseDocument.mockReturnValue({
      documentId: 'doc-stable-1',
      ydoc: mockYdoc,
      awareness: { setLocalStateField: jest.fn() } as unknown as Awareness,
      meta: { id: 'doc-stable-1', title: 'Stable Document', updatedAt: new Date().toISOString() },
      accessLevel: 'EDIT',
      isReadOnly: false,
      realtimeProvider: { awareness: {} } as unknown as WebsocketProvider,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      accessToken: 'new-token-123',
      user: { id: 'user-1', email: 'test@example.com', displayName: 'Test User' },
    });

    rerender(<Editor />);

    // Dependency array holds the document identity plus the stable attachment
    // callbacks; every entry must be unchanged across renders.
    const firstCallDeps = useCreateBlockNoteMock.mock.calls[0][1];
    const latestCallDeps =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][1];

    expect(firstCallDeps.slice(0, 2)).toEqual(['doc-stable-1', mockYdoc]);
    expect(firstCallDeps.slice(2)).toEqual([expect.any(Function), expect.any(Function)]);
    expect(latestCallDeps).toEqual(firstCallDeps);

    // The editor instance memoized by useCreateBlockNote should be strictly the same reference
    const firstCallEditor = useCreateBlockNoteMock.mock.results[0].value;
    const latestCallEditor =
      useCreateBlockNoteMock.mock.results[useCreateBlockNoteMock.mock.results.length - 1].value;

    expect(latestCallEditor).toBe(firstCallEditor);
  });

  it('should keep BlockNoteView editable prop stable across permission updates to avoid remount', () => {
    const mockUseDocument = useDocument as unknown as jest.Mock;
    const editorInstance = {
      document: [{ content: [] }],
      focus: jest.fn(),
      isEditable: false,
    };
    (useCreateBlockNote as jest.Mock).mockReturnValue(editorInstance);

    mockUseDocument.mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      awareness: null,
      meta: {
        id: 'test-doc-id',
        title: 'Permission Document',
        updatedAt: new Date().toISOString(),
      },
      accessLevel: 'VIEW',
      isReadOnly: true,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    const { rerender } = render(<Editor />);

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const firstEditable =
      blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0].editable;
    expect(firstEditable).toBe(false);

    // Simulate permission upgrade from VIEW to EDIT
    mockUseDocument.mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      awareness: null,
      meta: {
        id: 'test-doc-id',
        title: 'Permission Document',
        updatedAt: new Date().toISOString(),
      },
      accessLevel: 'EDIT',
      isReadOnly: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    rerender(<Editor />);

    // Frozen at first mount so BlockNoteViewEditor does not recreate its mount
    // ref (which would tear down the ProseMirror view / UndoManager).
    const latestEditable =
      blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0].editable;
    expect(latestEditable).toBe(false);
    // Read-only is still driven via the editor instance.
    expect(editorInstance.isEditable).toBe(true);
  });

  it('should enable multi-column blocks via withMultiColumn schema wrapper', () => {
    render(<Editor />);

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];
    // Schema passes through the mocked withMultiColumn (module-level wrapper),
    // preserving the extended-schema marker asserted above, and the editor is
    // configured with the resilient multi-column drop cursor wrapper.
    expect(lastConfig.schema).toEqual(expect.objectContaining({ isExtendedSchema: true }));
    expect(lastConfig.dropCursor).toEqual(expect.objectContaining({ hooks: expect.anything() }));
    expect(typeof lastConfig.dropCursor.hooks.computeDropPosition).toBe('function');
  });

  it('should configure multi-column drop cursor and dictionary', () => {
    render(<Editor />);

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];

    expect(lastConfig.dropCursor).toBeDefined();
    expect(lastConfig.dictionary).toEqual(
      expect.objectContaining({ multi_column: expect.anything() })
    );
  });

  it('should disable built-in slash menu since multi-column items use SuggestionMenuController', () => {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title: 'Editable doc',
      },
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastCall = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1];
    expect(lastCall[0]).toEqual(expect.objectContaining({ slashMenu: false }));
  });

  // BlockNoteView is mocked and never renders its children, so reach the
  // SuggestionMenuController element through BlockNoteView's props.
  async function getRenderedSlashMenuItems(query: string) {
    const { SuggestionMenuController } = await import('@blocknote/react');
    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastProps = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0];
    const menuElement = React.Children.toArray(lastProps.children).find(
      (child) => React.isValidElement(child) && child.type === SuggestionMenuController
    );
    if (
      !React.isValidElement<{
        getItems: (q: string) => Promise<Array<{ title?: string; onItemClick?: () => void }>>;
      }>(menuElement)
    ) {
      throw new Error('SuggestionMenuController was not rendered');
    }
    return menuElement.props.getItems(query);
  }

  function renderEditableDocWithTitle(title: string) {
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title,
      },
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);
  }

  it('should fall back to the default drop position when multi-column cursor computation throws', async () => {
    const xl = await import('@blocknote/xl-multi-column');
    const dropCursorMock = xl.multiColumnDropCursor as unknown as {
      hooks: Record<string, unknown>;
    };
    const upstream = jest.fn(() => {
      throw new Error('Position 999 out of range');
    });
    dropCursorMock.hooks.computeDropPosition = upstream;
    try {
      render(<Editor />);

      const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
      const lastConfig =
        useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];
      const fallback = { pos: 1 };

      expect(() =>
        lastConfig.dropCursor.hooks.computeDropPosition({ defaultPosition: fallback })
      ).not.toThrow();
      expect(lastConfig.dropCursor.hooks.computeDropPosition({ defaultPosition: fallback })).toBe(
        fallback
      );
      expect(upstream).toHaveBeenCalled();
    } finally {
      delete dropCursorMock.hooks.computeDropPosition;
    }
  });

  it('should include multi-column items merged into the slash menu', async () => {
    const xl = await import('@blocknote/xl-multi-column');
    (xl.getMultiColumnSlashMenuItems as jest.Mock).mockReturnValueOnce([
      {
        title: 'Two Columns',
        group: 'Basic blocks',
      },
    ]);
    renderEditableDocWithTitle('Multi-column doc');

    const items = await getRenderedSlashMenuItems('');
    expect(items).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Two Columns' })])
    );
  });

  it('should show editor when document contains column blocks with children in an untitled document', () => {
    const editorWithColumnBlock = {
      isEditable: true,
      document: [
        {
          id: 'col-list-1',
          type: 'columnList',
          children: [{ id: 'col-1', type: 'column', children: [] }],
        },
      ],
      onChange: jest.fn(() => jest.fn()),
      focus: jest.fn(),
    };
    (useCreateBlockNote as jest.Mock).mockReturnValueOnce(editorWithColumnBlock);

    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title: 'Untitled',
      },
      accessLevel: 'EDIT',
      isReadOnly: false,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
  });

  it('should initialize BlockNote with math dictionary and mathBlock in schema', () => {
    render(<Editor />);

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];

    expect(lastConfig.schema).toBeDefined();
    expect(lastConfig.dictionary).toEqual(
      expect.objectContaining({
        math: expect.objectContaining({ block_type_select: { name: 'Equation' } }),
      })
    );
  });

  it('should include math items merged into the slash menu', async () => {
    renderEditableDocWithTitle('Math doc');

    const items = await getRenderedSlashMenuItems('');
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Block Equation' }),
        expect.objectContaining({ title: 'Inline Equation' }),
      ])
    );
  });

  it('should render FormattingToolbarController with math block type item when editable', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');
    const { getMathBlockTypeSelectItems } = await import('@blocknote/math-block');
    renderEditableDocWithTitle('Math toolbar doc');

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastProps = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0];
    const toolbarElement = React.Children.toArray(lastProps.children).find(
      (child) => React.isValidElement(child) && child.type === FormattingToolbarController
    );
    expect(toolbarElement).toBeDefined();
    if (
      !React.isValidElement<{
        formattingToolbar: () => React.ReactElement<{ blockTypeSelectItems: unknown }>;
      }>(toolbarElement)
    ) {
      throw new Error('FormattingToolbarController was not rendered');
    }
    const renderedToolbar = toolbarElement.props.formattingToolbar();
    expect(getMathBlockTypeSelectItems).toHaveBeenCalled();
    expect(renderedToolbar.props.blockTypeSelectItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Equation' })])
    );
  });

  it('should initialize BlockNote with diagram dictionary and diagram in schema', () => {
    render(<Editor />);

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];

    expect(lastConfig.schema).toBeDefined();
    expect(lastConfig.dictionary).toEqual(
      expect.objectContaining({
        diagram: expect.objectContaining({ block_type_select: { name: 'Diagram' } }),
      })
    );
  });

  it('should include diagram items merged into the slash menu', async () => {
    renderEditableDocWithTitle('Diagram doc');

    const items = await getRenderedSlashMenuItems('');
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Diagram' })]));
  });

  it('should render FormattingToolbarController with diagram block type item when editable', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');
    const { getDiagramBlockTypeSelectItems } = await import('@blocknote/diagram-block');
    renderEditableDocWithTitle('Diagram toolbar doc');

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastProps = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0];
    const toolbarElement = React.Children.toArray(lastProps.children).find(
      (child) => React.isValidElement(child) && child.type === FormattingToolbarController
    );
    expect(toolbarElement).toBeDefined();
    if (
      !React.isValidElement<{
        formattingToolbar: () => React.ReactElement<{ blockTypeSelectItems: unknown }>;
      }>(toolbarElement)
    ) {
      throw new Error('FormattingToolbarController was not rendered');
    }
    const renderedToolbar = toolbarElement.props.formattingToolbar();
    expect(getDiagramBlockTypeSelectItems).toHaveBeenCalled();
    expect(renderedToolbar.props.blockTypeSelectItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Diagram' })])
    );
  });

  it('should not render FormattingToolbarController when view-only', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');
    (useDocument as jest.Mock).mockReturnValue({
      documentId: 'test-doc-id',
      ydoc: mockYdoc,
      meta: {
        ...mockMeta,
        title: 'Math viewer doc',
      },
      accessLevel: 'VIEW',
      isReadOnly: true,
      isRealtimeConnected: false,
      realtimeProvider: null,
      errorState: null,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    render(<Editor />);

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastProps = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0];
    const toolbarElement = React.Children.toArray(lastProps.children).find(
      (child) => React.isValidElement(child) && child.type === FormattingToolbarController
    );
    expect(toolbarElement).toBeUndefined();
  });

  function getBlockNoteViewChildren() {
    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastProps = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0];
    return React.Children.toArray(lastProps.children);
  }

  function findChild(children: React.ReactNode[], type: unknown) {
    return children.find((child) => React.isValidElement(child) && child.type === type);
  }

  /** The buttons a toolbar controller would render, without mounting them. */
  function toolbarChildren(toolbarElement: React.ReactNode) {
    if (
      !React.isValidElement<{
        formattingToolbar: () => React.ReactElement<{ children?: React.ReactNode }>;
      }>(toolbarElement)
    ) {
      throw new Error('Toolbar controller was not rendered');
    }

    return React.Children.toArray(toolbarElement.props.formattingToolbar().props.children);
  }

  it('should render the docked toolbar instead of the floating one on a touch device', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');
    stubTouchInput();
    renderEditableDocWithTitle('Touch toolbar doc');

    const children = getBlockNoteViewChildren();

    expect(findChild(children, MobileFormattingToolbarController)).toBeDefined();
    // The floating toolbar would sit under the on-screen keyboard here.
    expect(findChild(children, FormattingToolbarController)).toBeUndefined();
  });

  it('should put the add-block button in the docked toolbar only', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');

    renderEditableDocWithTitle('Mouse add block doc');
    expect(
      findChild(
        toolbarChildren(findChild(getBlockNoteViewChildren(), FormattingToolbarController)),
        MobileAddBlockButton
      )
    ).toBeUndefined();

    cleanup();
    stubTouchInput();
    renderEditableDocWithTitle('Touch add block doc');

    // Touch devices have no side menu, so the docked bar carries its "+".
    expect(
      findChild(
        toolbarChildren(findChild(getBlockNoteViewChildren(), MobileFormattingToolbarController)),
        MobileAddBlockButton
      )
    ).toBeDefined();
  });

  it('should put the delete-block button beside the add-block one in the docked toolbar only', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');

    renderEditableDocWithTitle('Mouse delete block doc');
    expect(
      findChild(
        toolbarChildren(findChild(getBlockNoteViewChildren(), FormattingToolbarController)),
        MobileDeleteBlockButton
      )
    ).toBeUndefined();

    cleanup();
    stubTouchInput();
    renderEditableDocWithTitle('Touch delete block doc');

    // Touch devices have no side menu, so its drag-handle menu is gone too: the
    // docked bar is the only place a block can be deleted from.
    const buttons = toolbarChildren(
      findChild(getBlockNoteViewChildren(), MobileFormattingToolbarController)
    );
    const addBlockIndex = buttons.findIndex(
      (child) => React.isValidElement(child) && child.type === MobileAddBlockButton
    );
    const deleteBlockIndex = buttons.findIndex(
      (child) => React.isValidElement(child) && child.type === MobileDeleteBlockButton
    );

    // Both are block actions the side menu owns on desktop, so they sit together
    // at the head of the bar, ahead of the inline-formatting buttons.
    expect(addBlockIndex).toBeGreaterThanOrEqual(0);
    expect(deleteBlockIndex).toBe(addBlockIndex + 1);
  });

  it('should ask the docked bar for a dismiss-keyboard button only on touch', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');

    renderEditableDocWithTitle('Mouse dismiss keyboard doc');
    const mouseController = findChild(getBlockNoteViewChildren(), FormattingToolbarController) as
      React.ReactElement<{ dismissButton?: boolean }> | undefined;
    expect(mouseController).toBeDefined();
    expect(mouseController!.props.dismissButton).toBeFalsy();

    cleanup();
    stubTouchInput();
    renderEditableDocWithTitle('Touch dismiss keyboard doc');

    // Dropping the caret is touch chrome, like the docked bar it lives in.
    const touchController = findChild(
      getBlockNoteViewChildren(),
      MobileFormattingToolbarController
    ) as React.ReactElement<{ dismissButton?: boolean }> | undefined;
    expect(touchController).toBeDefined();
    expect(touchController!.props.dismissButton).toBe(true);
  });

  it('should keep the floating toolbar on a narrow viewport driven by a mouse', async () => {
    const { FormattingToolbarController } = await import('@blocknote/react');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        // A resized desktop window: narrow, but still a mouse.
        matches: query === MOBILE_LAYOUT_QUERY,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });
    renderEditableDocWithTitle('Narrow desktop doc');

    const children = getBlockNoteViewChildren();

    expect(findChild(children, FormattingToolbarController)).toBeDefined();
    expect(findChild(children, MobileFormattingToolbarController)).toBeUndefined();
  });

  it('should render the block side menu for a mouse and drop it for touch input', async () => {
    const { SideMenuController } = await import('@blocknote/react');

    renderEditableDocWithTitle('Mouse side menu doc');
    expect(findChild(getBlockNoteViewChildren(), SideMenuController)).toBeDefined();

    cleanup();
    stubTouchInput();
    renderEditableDocWithTitle('Touch side menu doc');

    // Touch devices lose the handles entirely — the gutter they would have
    // reserved goes back to the text (see the `(pointer: coarse)` CSS block).
    expect(findChild(getBlockNoteViewChildren(), SideMenuController)).toBeUndefined();
  });

  it('should render FormattingToolbarController with inline code button when editable', async () => {
    const { FormattingToolbarController, BasicTextStyleButton } = await import('@blocknote/react');
    renderEditableDocWithTitle('Inline code toolbar doc');

    const blockNoteViewMock = BlockNoteView as unknown as jest.Mock;
    const lastProps = blockNoteViewMock.mock.calls[blockNoteViewMock.mock.calls.length - 1][0];
    const toolbarElement = React.Children.toArray(lastProps.children).find(
      (child) => React.isValidElement(child) && child.type === FormattingToolbarController
    );
    expect(toolbarElement).toBeDefined();
    if (
      !React.isValidElement<{
        formattingToolbar: () => React.ReactElement<{ children?: React.ReactNode }>;
      }>(toolbarElement)
    ) {
      throw new Error('FormattingToolbarController was not rendered');
    }
    const renderedToolbar = toolbarElement.props.formattingToolbar();
    const children = React.Children.toArray(renderedToolbar.props.children);
    const codeButton = children.find(
      (child) =>
        React.isValidElement<{ basicTextStyle?: string }>(child) &&
        child.type === BasicTextStyleButton &&
        child.props.basicTextStyle === 'code'
    );
    expect(codeButton).toBeDefined();
  });

  it('should configure code tooltip and Mod+E shortcut in formatting toolbar dictionary', () => {
    render(<Editor />);

    const useCreateBlockNoteMock = useCreateBlockNote as unknown as jest.Mock;
    const lastConfig =
      useCreateBlockNoteMock.mock.calls[useCreateBlockNoteMock.mock.calls.length - 1][0];

    expect(lastConfig.dictionary).toEqual(
      expect.objectContaining({
        formatting_toolbar: expect.objectContaining({
          code: {
            tooltip: 'Code',
            secondary_tooltip: 'Mod+E',
          },
        }),
      })
    );
  });

  describe('resolveNativeButton and customShadCNComponents', () => {
    it('correctly resolves nativeButton based on target element type', async () => {
      const { resolveNativeButton } = await import('@/components/editor/EditorContent');

      expect(resolveNativeButton(<button type="button">Click</button>)).toBe(true);
      expect(resolveNativeButton(<div>Non button</div>)).toBe(false);
      expect(resolveNativeButton(<span>Non button</span>)).toBe(false);

      const CustomComponent = () => null;
      expect(resolveNativeButton(<CustomComponent />)).toBe(true);

      expect(resolveNativeButton(<button>Click</button>, false)).toBe(false);
      expect(resolveNativeButton(<div>Click</div>, true)).toBe(true);
      expect(resolveNativeButton(null)).toBe(true);
    });

    it('passes nativeButton=true for button triggers and nativeButton=false for non-button triggers', async () => {
      const { customShadCNComponents } = await import('@/components/editor/EditorContent');
      const { ShadCNDefaultComponents } = await import('@blocknote/shadcn');

      const mockDropdownTrigger = jest.spyOn(
        ShadCNDefaultComponents.DropdownMenu,
        'DropdownMenuTrigger'
      );
      const mockPopoverTrigger = jest.spyOn(ShadCNDefaultComponents.Popover, 'PopoverTrigger');

      const DropdownMenuTrigger = customShadCNComponents.DropdownMenu
        ?.DropdownMenuTrigger as React.ComponentType<{
        render?: React.ReactNode;
        children?: React.ReactNode;
      }>;
      const PopoverTrigger = customShadCNComponents.Popover?.PopoverTrigger as React.ComponentType<{
        render?: React.ReactNode;
        children?: React.ReactNode;
      }>;

      expect(DropdownMenuTrigger).toBeDefined();
      expect(PopoverTrigger).toBeDefined();

      mockDropdownTrigger.mockClear();
      mockPopoverTrigger.mockClear();

      // Render button through DropdownMenuTrigger (e.g. SideMenu DragHandleButton)
      render(<DropdownMenuTrigger render={<button type="button">Drag</button>} />);

      expect(mockDropdownTrigger.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          nativeButton: true,
        })
      );

      // Render div through PopoverTrigger (e.g. EmojiPicker)
      render(<PopoverTrigger render={<div>Emoji</div>} />);

      expect(mockPopoverTrigger.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          nativeButton: false,
        })
      );

      // When render is omitted and only children is passed, nativeButton defaults to true
      mockDropdownTrigger.mockClear();
      render(
        <DropdownMenuTrigger>
          <div>Child inside default native button</div>
        </DropdownMenuTrigger>
      );
      expect(mockDropdownTrigger.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          nativeButton: true,
        })
      );
    });

    it('portals TooltipContent, DropdownMenuContent, and PopoverContent to document.body', async () => {
      const { customShadCNComponents } = await import('@/components/editor/EditorContent');
      const { ShadCNDefaultComponents } = await import('@blocknote/shadcn');

      const mockTooltipContent = jest.spyOn(ShadCNDefaultComponents.Tooltip, 'TooltipContent');
      const mockDropdownMenuContent = jest.spyOn(
        ShadCNDefaultComponents.DropdownMenu,
        'DropdownMenuContent'
      );
      const mockPopoverContent = jest.spyOn(ShadCNDefaultComponents.Popover, 'PopoverContent');

      mockTooltipContent.mockClear();
      mockDropdownMenuContent.mockClear();
      mockPopoverContent.mockClear();

      const TooltipContent = customShadCNComponents.Tooltip?.TooltipContent as React.ComponentType<{
        container?: HTMLElement | null;
        children?: React.ReactNode;
      }>;
      const DropdownMenuContent = customShadCNComponents.DropdownMenu
        ?.DropdownMenuContent as React.ComponentType<{
        container?: HTMLElement | null;
        children?: React.ReactNode;
      }>;
      const PopoverContent = customShadCNComponents.Popover?.PopoverContent as React.ComponentType<{
        container?: HTMLElement | null;
        children?: React.ReactNode;
      }>;

      expect(TooltipContent).toBeDefined();
      expect(DropdownMenuContent).toBeDefined();
      expect(PopoverContent).toBeDefined();

      const dummyElement = document.createElement('div');

      // Even if BlockNote passes container={editor.portalElement}, it should be redirected to document.body
      render(<TooltipContent container={dummyElement}>Tooltip text</TooltipContent>);
      expect(mockTooltipContent.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          container: document.body,
        })
      );

      render(<DropdownMenuContent container={dummyElement}>Menu text</DropdownMenuContent>);
      expect(mockDropdownMenuContent.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          container: document.body,
        })
      );

      render(<PopoverContent container={dummyElement}>Popover text</PopoverContent>);
      expect(mockPopoverContent.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          container: document.body,
        })
      );
    });
  });

  describe('file uploads', () => {
    const storedAttachmentUrl = '/api/v1/attachments/11111111-2222-4333-8444-555555555555';
    const authenticatedUser = {
      id: 'user-1',
      displayName: 'Jane Doe',
      email: 'jane@example.com',
      avatarUrl: null,
    };

    function lastEditorConfig() {
      const mock = useCreateBlockNote as unknown as jest.Mock;
      return mock.mock.calls[mock.mock.calls.length - 1][0] as {
        uploadFile: (file: File, blockId?: string) => Promise<string>;
        resolveFileUrl: (url: string) => Promise<string>;
      };
    }

    /** An authenticated, online, editable cloud document — uploads are allowed. */
    function useEditableCloudDocument() {
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token',
        user: authenticatedUser,
      });
      (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: true, isOffline: false });
      (useDocument as jest.Mock).mockReturnValue({
        documentId: 'test-doc-id',
        ydoc: mockYdoc,
        meta: mockMeta,
        accessLevel: 'EDIT',
        isReadOnly: false,
        realtimeProvider: null,
        errorState: null,
        isLoading: false,
        error: null,
        updateMeta: mockUpdateMeta,
      });
    }

    function renderWithToasts() {
      const store = configureStore({ reducer: { ui: uiReducer, toasts: toastsReducer } });
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      render(<Editor />, store);
      return dispatchSpy;
    }

    /**
     * Intercepts thunk dispatches (the session refresh) while letting plain actions
     * reach the reducers. A null token models a refresh that failed outright.
     */
    function renderWithToastsAndRefresh(refreshedAccessToken: string | null) {
      const store = configureStore({ reducer: { ui: uiReducer, toasts: toastsReducer } });
      const realDispatch = store.dispatch.bind(store);
      const dispatchSpy = jest.spyOn(store, 'dispatch').mockImplementation(((action: unknown) => {
        if (typeof action === 'function') {
          return refreshedAccessToken === null
            ? { type: 'auth/refresh/rejected' }
            : {
                type: 'auth/refresh/fulfilled',
                payload: { accessToken: refreshedAccessToken },
              };
        }
        return (realDispatch as (action: unknown) => unknown)(action);
      }) as never);
      render(<Editor />, store);
      return dispatchSpy;
    }

    function toastCalls(dispatchSpy: { mock: { calls: unknown[][] } }) {
      return dispatchSpy.mock.calls.filter(
        (call) => (call[0] as { type?: string } | undefined)?.type === 'toasts/addToast'
      );
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('configures BlockNote with upload and URL resolution hooks', () => {
      useEditableCloudDocument();

      render(<Editor />);

      const config = lastEditorConfig();
      expect(typeof config.uploadFile).toBe('function');
      expect(typeof config.resolveFileUrl).toBe('function');
    });

    it('uploads through the attachment service and stores the relative URL', async () => {
      useEditableCloudDocument();
      jest.spyOn(attachmentService, 'uploadAttachment').mockResolvedValue({
        id: 'attachment-1',
        documentId: 'test-doc-id',
        fileName: 'a.png',
        contentType: 'image/png',
        sizeBytes: 3,
        url: storedAttachmentUrl,
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      render(<Editor />);

      const file = new File(['abc'], 'a.png', { type: 'image/png' });
      await expect(lastEditorConfig().uploadFile(file)).resolves.toBe(storedAttachmentUrl);
      expect(attachmentService.uploadAttachment).toHaveBeenCalledWith('test-doc-id', file, 'token');
    });

    it('sends an empty File to the service instead of blocking it client-side', async () => {
      useEditableCloudDocument();
      const uploadSpy = jest.spyOn(attachmentService, 'uploadAttachment').mockResolvedValue({
        id: 'attachment-1',
        documentId: 'test-doc-id',
        fileName: 'empty.png',
        contentType: 'image/png',
        sizeBytes: 0,
        url: storedAttachmentUrl,
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      render(<Editor />);

      // Emptiness is a server 400/413 decision; the editor must not invent its own gate.
      const file = new File([], 'empty.png', { type: 'image/png' });
      await expect(lastEditorConfig().uploadFile(file)).resolves.toBe(storedAttachmentUrl);
      expect(uploadSpy).toHaveBeenCalledWith('test-doc-id', file, 'token');
    });

    it('caps concurrent uploads at four with the fifth queued behind them', async () => {
      useEditableCloudDocument();
      const resolvers: Array<
        (value: {
          id: string;
          documentId: string;
          fileName: string;
          contentType: string;
          sizeBytes: number;
          url: string;
          createdAt: string;
        }) => void
      > = [];
      const uploadSpy = jest.spyOn(attachmentService, 'uploadAttachment').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          })
      );
      render(<Editor />);

      const uploads = Array.from({ length: 5 }, (_unused, index) =>
        lastEditorConfig().uploadFile(new File(['x'], `f-${index}.png`))
      );
      uploads.forEach((promise) => promise.catch(() => undefined));
      await Promise.resolve();
      await Promise.resolve();

      // Four run at once; the fifth waits for a slot instead of firing a fifth request.
      expect(uploadSpy).toHaveBeenCalledTimes(4);

      const attachment = {
        id: 'attachment-1',
        documentId: 'test-doc-id',
        fileName: 'f.png',
        contentType: 'image/png',
        sizeBytes: 1,
        url: storedAttachmentUrl,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
      // Free one slot; the queued fifth upload starts and registers its own resolver.
      resolvers[0](attachment);
      await flush();
      expect(uploadSpy).toHaveBeenCalledTimes(5);

      resolvers.slice(1).forEach((resolve) => resolve(attachment));
      await expect(Promise.all(uploads)).resolves.toHaveLength(5);
    });

    it('toasts and rejects when the browser is offline', async () => {
      useEditableCloudDocument();
      (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: false, isOffline: true });
      const uploadSpy = jest.spyOn(attachmentService, 'uploadAttachment');
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toThrow(
        /offline/i
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toasts/addToast' })
      );
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('toasts and rejects for viewers without edit access', async () => {
      useEditableCloudDocument();
      (useDocument as jest.Mock).mockReturnValue({
        documentId: 'test-doc-id',
        ydoc: mockYdoc,
        meta: { ...mockMeta, title: 'Shared doc' },
        accessLevel: 'VIEW',
        isReadOnly: true,
        realtimeProvider: null,
        errorState: null,
        isLoading: false,
        error: null,
        updateMeta: mockUpdateMeta,
      });
      const uploadSpy = jest.spyOn(attachmentService, 'uploadAttachment');
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toThrow(
        /permission/i
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toasts/addToast' })
      );
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('toasts and rejects for signed-out visitors', async () => {
      useEditableCloudDocument();
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: false,
        accessToken: null,
        user: null,
      });
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toThrow(
        /Sign in/i
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toasts/addToast' })
      );
    });

    it('toasts and rejects for trashed documents', async () => {
      useEditableCloudDocument();
      (useDocument as jest.Mock).mockReturnValue({
        documentId: 'test-doc-id',
        ydoc: mockYdoc,
        meta: { ...mockMeta, deletedAt: '2026-01-01T00:00:00Z' },
        accessLevel: 'EDIT',
        isReadOnly: false,
        realtimeProvider: null,
        errorState: null,
        isLoading: false,
        error: null,
        updateMeta: mockUpdateMeta,
      });
      const uploadSpy = jest.spyOn(attachmentService, 'uploadAttachment');
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toThrow(
        /trash/i
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toasts/addToast' })
      );
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('toasts and rejects while the access level is still loading', async () => {
      useEditableCloudDocument();
      (useDocument as jest.Mock).mockReturnValue({
        documentId: 'test-doc-id',
        ydoc: mockYdoc,
        meta: mockMeta,
        accessLevel: null,
        isReadOnly: true,
        realtimeProvider: null,
        errorState: null,
        isLoading: false,
        error: null,
        updateMeta: mockUpdateMeta,
      });
      const uploadSpy = jest.spyOn(attachmentService, 'uploadAttachment');
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toThrow(
        /syncing/i
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toasts/addToast' })
      );
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('toasts the server size message when it rejects an oversized file', async () => {
      useEditableCloudDocument();
      jest
        .spyOn(attachmentService, 'uploadAttachment')
        .mockRejectedValue(
          new AttachmentServiceApiError('File exceeds the maximum allowed size of 25.0 MB.', 413)
        );
      const dispatchSpy = renderWithToasts();

      await expect(
        lastEditorConfig().uploadFile(new File(['abc'], 'big.zip'))
      ).rejects.toBeInstanceOf(AttachmentServiceApiError);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'toasts/addToast',
          payload: expect.objectContaining({
            message: expect.stringContaining('File exceeds the maximum allowed size of 25.0 MB.'),
          }),
        })
      );
    });

    it('toasts the storage-quota message instead of blaming the file size', async () => {
      useEditableCloudDocument();
      jest
        .spyOn(attachmentService, 'uploadAttachment')
        .mockRejectedValue(
          new AttachmentServiceApiError('This upload would exceed your 2.0 GB storage limit.', 413)
        );
      const dispatchSpy = renderWithToasts();

      await expect(
        lastEditorConfig().uploadFile(new File(['abc'], 'big.zip'))
      ).rejects.toBeInstanceOf(AttachmentServiceApiError);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'toasts/addToast',
          payload: expect.objectContaining({
            message: expect.stringContaining('2.0 GB storage limit'),
          }),
        })
      );
    });

    it('resolves stored attachment URLs through the attachment service', async () => {
      useEditableCloudDocument();
      jest
        .spyOn(attachmentService, 'resolveAttachmentUrl')
        .mockResolvedValue('http://localhost:8080/api/v1/attachments/x/file?exp=1&sig=s');

      render(<Editor />);

      await expect(lastEditorConfig().resolveFileUrl(storedAttachmentUrl)).resolves.toBe(
        'http://localhost:8080/api/v1/attachments/x/file?exp=1&sig=s'
      );
      expect(attachmentService.resolveAttachmentUrl).toHaveBeenCalledWith(
        storedAttachmentUrl,
        'token'
      );
    });

    it('toasts once when a file URL cannot be resolved, without swallowing the rejection', async () => {
      useEditableCloudDocument();
      jest
        .spyOn(attachmentService, 'resolveAttachmentUrl')
        .mockRejectedValue(new UnsupportedUrlError());
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().resolveFileUrl('javascript:alert(1)')).rejects.toBeInstanceOf(
        UnsupportedUrlError
      );
      await expect(lastEditorConfig().resolveFileUrl('javascript:alert(1)')).rejects.toBeInstanceOf(
        UnsupportedUrlError
      );

      const toastCalls = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as { type?: string } | undefined)?.type === 'toasts/addToast'
      );
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0][0]).toMatchObject({
        payload: expect.objectContaining({ message: expect.stringContaining('unsupported') }),
      });
    });

    it('toasts and rejects for commenters without edit access', async () => {
      useEditableCloudDocument();
      (useDocument as jest.Mock).mockReturnValue({
        documentId: 'test-doc-id',
        ydoc: mockYdoc,
        meta: mockMeta,
        accessLevel: 'COMMENT',
        isReadOnly: true,
        realtimeProvider: null,
        errorState: null,
        isLoading: false,
        error: null,
        updateMeta: mockUpdateMeta,
      });
      const uploadSpy = jest.spyOn(attachmentService, 'uploadAttachment');
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toThrow(
        /permission/i
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toasts/addToast' })
      );
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('surfaces the server message for unexpected upload failures', async () => {
      useEditableCloudDocument();
      jest
        .spyOn(attachmentService, 'uploadAttachment')
        .mockRejectedValue(new AttachmentServiceApiError('Boom', 500));
      const dispatchSpy = renderWithToasts();

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toMatchObject(
        { status: 500 }
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'toasts/addToast',
          payload: expect.objectContaining({ message: 'Boom' }),
        })
      );
    });

    it('refreshes the session and retries an upload once after a 401', async () => {
      useEditableCloudDocument();
      const uploadSpy = jest
        .spyOn(attachmentService, 'uploadAttachment')
        .mockRejectedValueOnce(new AttachmentServiceApiError('Unauthorized', 401))
        .mockResolvedValue({
          id: 'attachment-1',
          documentId: 'test-doc-id',
          fileName: 'a.png',
          contentType: 'image/png',
          sizeBytes: 3,
          url: storedAttachmentUrl,
          createdAt: '2026-01-01T00:00:00.000Z',
        });
      renderWithToastsAndRefresh('refreshed-token');

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).resolves.toBe(
        storedAttachmentUrl
      );
      expect(uploadSpy).toHaveBeenCalledTimes(2);
      expect(uploadSpy).toHaveBeenNthCalledWith(1, 'test-doc-id', expect.any(File), 'token');
      expect(uploadSpy).toHaveBeenNthCalledWith(
        2,
        'test-doc-id',
        expect.any(File),
        'refreshed-token'
      );
    });

    it('surfaces session expiry when the refresh also fails', async () => {
      useEditableCloudDocument();
      const uploadSpy = jest
        .spyOn(attachmentService, 'uploadAttachment')
        .mockRejectedValue(new AttachmentServiceApiError('Unauthorized', 401));
      const dispatchSpy = renderWithToastsAndRefresh(null);

      await expect(lastEditorConfig().uploadFile(new File(['abc'], 'a.png'))).rejects.toMatchObject(
        { status: 401 }
      );
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'toasts/addToast',
          payload: expect.objectContaining({ message: expect.stringContaining('session expired') }),
        })
      );
    });

    it('refreshes the session and retries a resolve once after a 401', async () => {
      useEditableCloudDocument();
      const resolveSpy = jest
        .spyOn(attachmentService, 'resolveAttachmentUrl')
        .mockRejectedValueOnce(new AttachmentServiceApiError('Unauthorized', 401))
        .mockResolvedValue('http://localhost:8080/api/v1/attachments/x/file?exp=1&sig=s');
      renderWithToastsAndRefresh('refreshed-token');

      await expect(lastEditorConfig().resolveFileUrl(storedAttachmentUrl)).resolves.toBe(
        'http://localhost:8080/api/v1/attachments/x/file?exp=1&sig=s'
      );
      expect(resolveSpy).toHaveBeenNthCalledWith(1, storedAttachmentUrl, 'token');
      expect(resolveSpy).toHaveBeenNthCalledWith(2, storedAttachmentUrl, 'refreshed-token');
    });

    it('shares one token refresh across concurrent 401s', async () => {
      useEditableCloudDocument();
      const resolveSpy = jest
        .spyOn(attachmentService, 'resolveAttachmentUrl')
        .mockRejectedValueOnce(new AttachmentServiceApiError('Unauthorized', 401))
        .mockRejectedValueOnce(new AttachmentServiceApiError('Unauthorized', 401))
        .mockRejectedValueOnce(new AttachmentServiceApiError('Unauthorized', 401))
        .mockRejectedValueOnce(new AttachmentServiceApiError('Unauthorized', 401))
        .mockResolvedValue('http://localhost:8080/api/v1/attachments/x/file?exp=1&sig=s');
      const dispatchSpy = renderWithToastsAndRefresh('refreshed-token');

      const results = await Promise.all([
        lastEditorConfig().resolveFileUrl(storedAttachmentUrl),
        lastEditorConfig().resolveFileUrl(storedAttachmentUrl),
        lastEditorConfig().resolveFileUrl(storedAttachmentUrl),
        lastEditorConfig().resolveFileUrl(storedAttachmentUrl),
      ]);

      expect(results).toHaveLength(4);
      // Four blocks 401ing together must trigger one refresh, not four.
      const refreshCalls = dispatchSpy.mock.calls.filter((call) => typeof call[0] === 'function');
      expect(refreshCalls).toHaveLength(1);
      expect(resolveSpy).toHaveBeenCalledTimes(8);
    });

    it('toasts the retry failure when the post-refresh resolve also fails', async () => {
      useEditableCloudDocument();
      const resolveSpy = jest
        .spyOn(attachmentService, 'resolveAttachmentUrl')
        .mockRejectedValueOnce(new AttachmentServiceApiError('Unauthorized', 401))
        .mockRejectedValue(new AttachmentServiceApiError('Still broken', 500));
      const dispatchSpy = renderWithToastsAndRefresh('refreshed-token');

      await expect(lastEditorConfig().resolveFileUrl(storedAttachmentUrl)).rejects.toMatchObject({
        status: 500,
      });
      expect(resolveSpy).toHaveBeenCalledTimes(2);
      expect(toastCalls(dispatchSpy)).toHaveLength(1);
    });

    it('throttles resolve errors per URL instead of sharing one slot', async () => {
      useEditableCloudDocument();
      jest
        .spyOn(attachmentService, 'resolveAttachmentUrl')
        .mockRejectedValue(new AttachmentServiceApiError('nope', 404));
      const dispatchSpy = renderWithToasts();

      // Two alternating broken files must each toast once, not suppress each other.
      await expect(
        lastEditorConfig().resolveFileUrl('https://a.example.com/broken')
      ).rejects.toBeInstanceOf(AttachmentServiceApiError);
      await expect(
        lastEditorConfig().resolveFileUrl('https://b.example.com/broken')
      ).rejects.toBeInstanceOf(AttachmentServiceApiError);
      await expect(
        lastEditorConfig().resolveFileUrl('https://a.example.com/broken')
      ).rejects.toBeInstanceOf(AttachmentServiceApiError);

      expect(toastCalls(dispatchSpy)).toHaveLength(2);
    });

    it('delegates external URLs to the service without pre-validating them', async () => {
      useEditableCloudDocument();
      const resolveSpy = jest
        .spyOn(attachmentService, 'resolveAttachmentUrl')
        .mockResolvedValue('https://example.com/image.png');

      render(<Editor />);

      await expect(
        lastEditorConfig().resolveFileUrl('https://example.com/image.png')
      ).resolves.toBe('https://example.com/image.png');
      expect(resolveSpy).toHaveBeenCalledWith('https://example.com/image.png', 'token');
    });
  });
});
