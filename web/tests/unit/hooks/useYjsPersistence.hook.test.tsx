import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import documentReducer from '@/stores/document/document.slice';
import type { DocumentMeta } from '@/types/document.types';
import { useYjsPersistence } from '@/hooks/useYjsPersistence.hook';
import { documentService } from '@/services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(() => ({
    isAuthenticated: false,
    accessToken: null,
  })),
}));

describe('useYjsPersistence', () => {
  let saveDocumentSpy: jest.SpyInstance;
  let saveCloudDocumentSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    saveDocumentSpy = jest.spyOn(documentService, 'saveDocument').mockImplementation(jest.fn());
    saveCloudDocumentSpy = jest
      .spyOn(documentService, 'saveCloudDocument')
      .mockImplementation(jest.fn());
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    saveDocumentSpy.mockRestore();
    saveCloudDocumentSpy.mockRestore();
  });

  function createTestStore() {
    return configureStore({
      reducer: {
        document: documentReducer,
      },
    });
  }

  function wrapper({ children }: { children: React.ReactNode }) {
    const store = createTestStore();
    return <Provider store={store}>{children}</Provider>;
  }

  it('should save document after debounce when ydoc updates', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    expect(saveDocumentSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledWith('test-id', ydoc, meta);
    });
  });

  it('should debounce multiple rapid updates', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');

    fragment.push([new Y.XmlElement('paragraph')]);
    jest.advanceTimersByTime(100);

    fragment.push([new Y.XmlElement('paragraph')]);
    jest.advanceTimersByTime(100);

    fragment.push([new Y.XmlElement('paragraph')]);
    jest.advanceTimersByTime(100);

    expect(saveDocumentSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('should handle save errors gracefully', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockRejectedValue(new Error('Save failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to save document:', expect.any(Error));
    });

    consoleErrorSpy.mockRestore();
  });

  it('should not save if ydoc is null', () => {
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    renderHook(() => useYjsPersistence('test-id', null, meta), { wrapper });

    jest.advanceTimersByTime(500);

    expect(saveDocumentSpy).not.toHaveBeenCalled();
  });

  it('should not save if meta is null', () => {
    const ydoc = new Y.Doc();

    renderHook(() => useYjsPersistence('test-id', ydoc, null), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    jest.advanceTimersByTime(500);

    expect(saveDocumentSpy).not.toHaveBeenCalled();
  });

  it('should cleanup event listener on unmount', () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    unmount();

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    jest.advanceTimersByTime(500);

    expect(saveDocumentSpy).not.toHaveBeenCalled();
  });

  it('should return saving state and lastSaved timestamp', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    expect(result.current.isSaving).toBe(false);
    expect(result.current.lastSaved).toBeNull();

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(result.current.lastSaved).not.toBeNull();
    });

    expect(result.current.lastSaved).toBeInstanceOf(Date);
  });

  it('should save to cloud when authenticated', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Cloud Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    saveCloudDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveCloudDocumentSpy).toHaveBeenCalledWith('cloud-id', ydoc, meta, 'token-1');
    });

    expect(saveDocumentSpy).not.toHaveBeenCalled();
  });
});
