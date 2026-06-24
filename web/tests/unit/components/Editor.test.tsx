// Mock BlockNote BEFORE importing Editor
jest.mock('@blocknote/react', () => ({
  useCreateBlockNote: jest.fn(() => ({
    document: [{ content: [] }],
    focus: jest.fn(),
  })),
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
  FormattingToolbarController: () => null,
  FloatingComposerController: () => null,
  FloatingThreadController: () => null,
  ThreadsSidebar: () => <div data-testid="threads-sidebar" />,
}));

jest.mock('@blocknote/shadcn', () => ({
  BlockNoteView: jest.fn(() => <div data-testid="blocknote-view" />),
}));

jest.mock('@blocknote/core/comments', () => ({
  CommentsExtension: jest.fn(() => ({})),
  ThreadStoreAuth: class ThreadStoreAuth {},
  DefaultThreadStoreAuth: jest.fn(),
  YjsThreadStore: jest.fn(),
}));

jest.mock('../../../services/document.service', () => ({
  documentService: {
    listCollaborators: jest.fn().mockResolvedValue([]),
  },
}));

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import React from 'react';
import { render as baseRender, screen, fireEvent, act, waitFor } from '@testing-library/react';
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
import { CommentsExtension } from '@blocknote/core/comments';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '../../../lib/offline-navigation.util';
import * as Y from 'yjs';

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

    expect(
      screen.getByText(/You are viewing this shared document as a guest\./i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign up or log in/i }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ui/setAuthModalOpen', payload: true })
    );
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
    expect(lastConfig.extensions).toHaveLength(1);
    expect(CommentsExtension).toHaveBeenCalled();
  });

  it('should preserve selection for first comment click in comment-only mode', () => {
    const mockFocus = jest.fn();
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [] }],
      focus: mockFocus,
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
      | ((event: ReactPointerEvent<HTMLDivElement>) => void)
      | undefined;

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
});
