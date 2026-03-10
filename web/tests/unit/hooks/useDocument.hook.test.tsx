import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import documentReducer from '@/stores/document/document.slice';
import { useDocument } from '@/hooks/useDocument.hook';
import { documentService } from '@/services/document.service';
import { setYDoc } from '@/stores/document/ydoc-holder';

describe('useDocument', () => {
  let getOrCreateDocumentSpy: jest.SpyInstance;
  let updateMetadataSpy: jest.SpyInstance;
  let dispatchEventSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getOrCreateDocumentSpy = jest
      .spyOn(documentService, 'getOrCreateDocument')
      .mockImplementation(jest.fn());
    updateMetadataSpy = jest.spyOn(documentService, 'updateMetadata').mockImplementation(jest.fn());
    dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    getOrCreateDocumentSpy.mockRestore();
    updateMetadataSpy.mockRestore();
    dispatchEventSpy.mockRestore();
  });

  function createTestStore() {
    return configureStore({
      reducer: {
        document: documentReducer,
      },
    });
  }

  function createWrapper() {
    const store = createTestStore();
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    };
  }

  afterEach(() => {
    setYDoc(null);
  });

  it('should load document on mount', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.ydoc).toBe(ydoc);
    expect(result.current.meta).toEqual(meta);
    expect(result.current.error).toBeNull();
    expect(getOrCreateDocumentSpy).toHaveBeenCalledWith('test-id');
  });

  it('should use default document ID when none provided', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Default Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });

    const { result } = renderHook(() => useDocument(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getOrCreateDocumentSpy).toHaveBeenCalledWith('default-doc');
  });

  it('should handle load errors', async () => {
    getOrCreateDocumentSpy.mockRejectedValue(new Error('Load failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(new Error('Load failed'));
    expect(result.current.meta).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  it('should update metadata', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: 'Updated Title' });
    });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Updated Title');
    });

    expect(updateMetadataSpy).toHaveBeenCalledWith('test-id', {
      title: 'Updated Title',
    });

    // Check if CustomEvent was dispatched
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ title: 'Updated Title' }),
        }),
      })
    );
  });

  it('should not update metadata if meta is null', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    getOrCreateDocumentSpy.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    result.current.updateMeta({ title: 'Updated' });

    expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot update meta: meta is null');
    expect(updateMetadataSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should handle metadata update errors and rollback', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    updateMetadataSpy.mockRejectedValue(new Error('Update failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: 'Updated' });
    });

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist metadata update:',
        expect.any(Error)
      );
    });

    // Verify rollback: title should revert to original
    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Test');
    });

    consoleErrorSpy.mockRestore();
  });

  it('should not dispatch stale responses when id changes', async () => {
    const ydoc1 = new Y.Doc();
    const meta1 = {
      title: 'Doc 1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const ydoc2 = new Y.Doc();
    const meta2 = {
      title: 'Doc 2',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    // First call hangs, second resolves immediately
    let resolveFirst: ((value: { ydoc: Y.Doc; meta: typeof meta1 }) => void) | undefined;
    const firstPromise = new Promise<{ ydoc: Y.Doc; meta: typeof meta1 }>((resolve) => {
      resolveFirst = resolve;
    });

    getOrCreateDocumentSpy
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ ydoc: ydoc2, meta: meta2 });

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { rerender } = renderHook(({ docId }: { docId: string }) => useDocument(docId), {
      wrapper: Wrapper,
      initialProps: { docId: 'doc-1' },
    });

    // Change id before first load resolves
    rerender({ docId: 'doc-2' });

    await waitFor(() => {
      expect(store.getState().document.meta?.title).toBe('Doc 2');
    });

    // Now resolve the first (stale) request
    resolveFirst?.({ ydoc: ydoc1, meta: meta1 });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // State should still show Doc 2, not Doc 1
    expect(store.getState().document.meta?.title).toBe('Doc 2');
  });

  it('should not dispatch after unmount', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    let resolveLoad: ((value: { ydoc: Y.Doc; meta: typeof meta }) => void) | undefined;
    const loadPromise = new Promise<{ ydoc: Y.Doc; meta: typeof meta }>((resolve) => {
      resolveLoad = resolve;
    });
    getOrCreateDocumentSpy.mockReturnValue(loadPromise);

    const { unmount } = renderHook(() => useDocument('test-id'), {
      wrapper: createWrapper(),
    });

    unmount();

    resolveLoad?.({ ydoc, meta });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(getOrCreateDocumentSpy).toHaveBeenCalledTimes(1);
  });

  it('should return a stable updateMeta reference across re-renders', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateMetadataSpy.mockResolvedValue(undefined);

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { result, rerender } = renderHook(({ docId }: { docId: string }) => useDocument(docId), {
      wrapper: Wrapper,
      initialProps: { docId: 'test-id' },
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const firstRef = result.current.updateMeta;

    // Re-render with same props — reference should be stable
    rerender({ docId: 'test-id' });

    expect(result.current.updateMeta).toBe(firstRef);
  });
});
