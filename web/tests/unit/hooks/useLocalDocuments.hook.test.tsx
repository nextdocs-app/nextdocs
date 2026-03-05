import { renderHook, waitFor, act } from '@testing-library/react';
import { useLocalDocuments } from '@/hooks/useLocalDocuments.hook';
import { documentService } from '@/services/document.service';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: jest.fn().mockReturnValue('doc-1'),
  }),
}));

describe('useLocalDocuments', () => {
  let getAllDocumentsMetaSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getAllDocumentsMetaSpy = jest.spyOn(documentService, 'getAllDocumentsMeta');
  });

  afterEach(() => {
    getAllDocumentsMetaSpy.mockRestore();
  });

  it('should load documents on mount and sort by updatedAt', async () => {
    const mockDocs = [
      {
        id: '1',
        meta: {
          title: 'Doc 1',
          updatedAt: '2024-01-01T10:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
      {
        id: '2',
        meta: {
          title: 'Doc 2',
          updatedAt: '2024-01-01T12:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ];
    getAllDocumentsMetaSpy.mockResolvedValue(mockDocs);

    const { result } = renderHook(() => useLocalDocuments());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Check sorting: Doc 2 (12:00) should be before Doc 1 (10:00)
    expect(result.current.documents[0].id).toBe('2');
    expect(result.current.documents[1].id).toBe('1');
    expect(getAllDocumentsMetaSpy).toHaveBeenCalledTimes(1);
  });

  it('should refresh when manual refresh is called', async () => {
    getAllDocumentsMetaSpy.mockResolvedValue([]);
    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    getAllDocumentsMetaSpy.mockResolvedValue([
      {
        id: '3',
        meta: {
          title: 'New',
          updatedAt: '2024-01-01T13:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.documents).toHaveLength(1);
    expect(result.current.documents[0].id).toBe('3');
  });

  it('should update list when document-meta-updated event is dispatched', async () => {
    const initialDocs = [
      {
        id: '1',
        meta: {
          title: 'Old Title',
          updatedAt: '2024-01-01T10:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ];
    getAllDocumentsMetaSpy.mockResolvedValue(initialDocs);

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const updatedMeta = {
      title: 'New Title',
      updatedAt: '2024-01-01T11:00:00Z',
      createdAt: '2024-01-01T10:00:00Z',
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent('document-meta-updated', {
          detail: { id: '1', meta: updatedMeta },
        })
      );
    });

    expect(result.current.documents[0].meta.title).toBe('New Title');
  });

  it('should add new document to list when document-meta-updated event is dispatched for unknown id', async () => {
    getAllDocumentsMetaSpy.mockResolvedValue([]);
    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const newDocMeta = {
      title: 'New Doc',
      updatedAt: '2024-01-01T11:00:00Z',
      createdAt: '2024-01-01T11:00:00Z',
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent('document-meta-updated', {
          detail: { id: 'new-id', meta: newDocMeta },
        })
      );
    });

    expect(result.current.documents).toHaveLength(1);
    expect(result.current.documents[0].id).toBe('new-id');
  });
});
