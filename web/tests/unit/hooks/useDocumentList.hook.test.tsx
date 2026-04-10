import { renderHook, waitFor, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useDocumentList } from '@/hooks/useDocumentList.hook';
import { documentService } from '@/services/document.service';
import { useCloudBackoff } from '../../../hooks/useCloudBackoff.hook';
import { useAuth } from '../../../hooks/useAuth.hook';

const mockIsCloudInBackoff = jest.fn(() => false);
const mockTriggerCloudBackoff = jest.fn();
const mockClearCloudBackoff = jest.fn();

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(() => ({
    isAuthenticated: false,
    accessToken: null,
  })),
}));

jest.mock('../../../hooks/useCloudBackoff.hook', () => ({
  useCloudBackoff: jest.fn(),
}));

const waitForInitialLoad = async (
  result: { current: { isLoading: boolean; isSharedLoading: boolean } },
  options: { includeShared?: boolean } = {}
) => {
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });

  if (options.includeShared) {
    await waitFor(() => {
      expect(result.current.isSharedLoading).toBe(false);
    });
  }
};

describe('useDocumentList', () => {
  let getAllDocumentsMetaSpy: jest.SpyInstance;
  let listCloudDocumentsSpy: jest.SpyInstance;
  let listSharedDocumentsSpy: jest.SpyInstance;
  let listCollaboratorsSpy: jest.SpyInstance;
  let getCloudDocumentSpy: jest.SpyInstance;
  let saveDocumentSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getAllDocumentsMetaSpy = jest.spyOn(documentService, 'getAllDocumentsMeta');
    getAllDocumentsMetaSpy.mockResolvedValue([]);
    listCloudDocumentsSpy = jest.spyOn(documentService, 'listCloudDocuments');
    listSharedDocumentsSpy = jest.spyOn(documentService, 'listSharedDocuments');
    listCollaboratorsSpy = jest.spyOn(documentService, 'listCollaborators');
    mockIsCloudInBackoff.mockReturnValue(false);
    mockTriggerCloudBackoff.mockReset();
    mockClearCloudBackoff.mockReset();
    (useCloudBackoff as jest.Mock).mockReturnValue({
      isInBackoff: mockIsCloudInBackoff,
      trigger: mockTriggerCloudBackoff,
      clear: mockClearCloudBackoff,
    });
    getCloudDocumentSpy = jest.spyOn(documentService, 'getCloudDocument').mockResolvedValue({
      ydoc: new Y.Doc(),
      meta: {
        title: 'Cached Cloud Doc',
        updatedAt: '2024-01-01T12:00:00Z',
        createdAt: '2024-01-01T10:00:00Z',
      },
    });
    saveDocumentSpy = jest.spyOn(documentService, 'saveDocument').mockResolvedValue(undefined);

    listSharedDocumentsSpy.mockResolvedValue({
      items: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });
    listCollaboratorsSpy.mockResolvedValue([]);

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
    });
  });

  afterEach(() => {
    getAllDocumentsMetaSpy.mockRestore();
    listCloudDocumentsSpy.mockRestore();
    listSharedDocumentsSpy.mockRestore();
    listCollaboratorsSpy.mockRestore();
    getCloudDocumentSpy.mockRestore();
    saveDocumentSpy.mockRestore();
  });

  it('loads only first 7 local documents initially', async () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      id: `doc-${i + 1}`,
      meta: {
        title: `Doc ${i + 1}`,
        updatedAt: `2024-01-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
        createdAt: '2024-01-01T10:00:00Z',
      },
    }));

    getAllDocumentsMetaSpy.mockResolvedValue(docs);

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(result.current.documents).toHaveLength(7);
    expect(result.current.canShowAll).toBe(true);
    expect(result.current.isShowingAll).toBe(false);
  });

  it('shows all local docs progressively when showAll and loadMore are used', async () => {
    const docs = Array.from({ length: 30 }, (_, i) => ({
      id: `doc-${i + 1}`,
      meta: {
        title: `Doc ${i + 1}`,
        updatedAt: `2024-01-${String(10 + (i % 20)).padStart(2, '0')}T10:00:00Z`,
        createdAt: '2024-01-01T10:00:00Z',
      },
    }));

    getAllDocumentsMetaSpy.mockResolvedValue(docs);

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    act(() => {
      result.current.showAllDocuments();
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.isShowingAll).toBe(true);
    expect(result.current.documents.length).toBeGreaterThan(7);
  });

  it('loads first cloud page with size 7 when authenticated', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'cloud-1',
          meta: {
            title: 'Cloud Doc',
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 25,
      totalPages: 4,
      hasMore: true,
    });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 7);
    expect(result.current.documents[0].id).toBe('cloud-1');
    expect(result.current.canShowAll).toBe(true);
  });

  it('falls back to local documents when cloud list is unreachable', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
    });

    listCloudDocumentsSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    getAllDocumentsMetaSpy.mockResolvedValue([
      {
        id: 'local-1',
        meta: {
          title: 'Local Doc 1',
          updatedAt: '2024-01-03T10:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
      {
        id: 'local-2',
        meta: {
          title: 'Local Doc 2',
          updatedAt: '2024-01-02T10:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ]);

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(result.current.documents.map((doc) => doc.id)).toEqual(['local-1', 'local-2']);
    expect(result.current.sharedDocuments).toHaveLength(0);
  });

  it('loads next cloud page when in show-all mode', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    listCloudDocumentsSpy
      .mockResolvedValueOnce({
        items: Array.from({ length: 7 }, (_, i) => ({
          id: `cloud-${i + 1}`,
          meta: {
            title: `Cloud ${i + 1}`,
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        })),
        page: 0,
        size: 7,
        totalElements: 30,
        totalPages: 5,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `cloud-expanded-${i + 1}`,
          meta: {
            title: `Cloud Expanded ${i + 1}`,
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        })),
        page: 0,
        size: 20,
        totalElements: 30,
        totalPages: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `cloud-next-${i + 1}`,
          meta: {
            title: `Cloud Next ${i + 1}`,
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        })),
        page: 1,
        size: 20,
        totalElements: 30,
        totalPages: 2,
        hasMore: false,
      });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    act(() => {
      result.current.showAllDocuments();
    });

    await waitFor(() => {
      expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 20);
    });

    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.documents.length).toBe(20);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 7);
    expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 20);
    expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 1, 20);
    expect(result.current.documents.length).toBe(30);
    expect(result.current.hasMore).toBe(false);
  });

  it('refreshes when cloud-documents-changed event is dispatched', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    listCloudDocumentsSpy
      .mockResolvedValueOnce({
        items: [],
        page: 0,
        size: 7,
        totalElements: 0,
        totalPages: 0,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'cloud-2',
            meta: {
              title: 'Imported Doc',
              updatedAt: '2024-01-01T12:00:00Z',
              createdAt: '2024-01-01T10:00:00Z',
            },
          },
        ],
        page: 0,
        size: 7,
        totalElements: 1,
        totalPages: 1,
        hasMore: false,
      });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });
    expect(result.current.documents).toHaveLength(0);

    act(() => {
      window.dispatchEvent(new CustomEvent('cloud-documents-changed'));
    });

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(1);
    });

    expect(result.current.documents[0].id).toBe('cloud-2');
  });

  it('moves owner documents with collaborators to shared list', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'owner-private-doc',
          meta: {
            title: 'Owner Private',
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
        {
          id: 'owner-shared-doc',
          meta: {
            title: 'Owner Shared',
            updatedAt: '2024-01-01T13:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 2,
      totalPages: 1,
      hasMore: false,
    });

    listCollaboratorsSpy.mockImplementation(async (documentId: string) => {
      if (documentId === 'owner-shared-doc') {
        return [
          {
            userId: 'owner-1',
            email: 'owner@example.com',
            displayName: 'Owner',
            accessLevel: 'OWNER',
            addedAt: '2024-01-01T10:00:00Z',
          },
          {
            userId: 'collab-1',
            email: 'collab@example.com',
            displayName: 'Collaborator',
            accessLevel: 'EDIT',
            addedAt: '2024-01-01T11:00:00Z',
          },
        ];
      }

      return [
        {
          userId: 'owner-1',
          email: 'owner@example.com',
          displayName: 'Owner',
          accessLevel: 'OWNER',
          addedAt: '2024-01-01T10:00:00Z',
        },
      ];
    });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(result.current.documents.map((doc) => doc.id)).toEqual(['owner-private-doc']);
    expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['owner-shared-doc']);
  });

  it('shows all shared documents and paginates shared-with-me list', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: [],
      page: 0,
      size: 7,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });

    listSharedDocumentsSpy
      .mockResolvedValueOnce({
        items: Array.from({ length: 7 }, (_, i) => ({
          id: `shared-initial-${i + 1}`,
          meta: {
            title: `Shared Initial ${i + 1}`,
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        })),
        page: 0,
        size: 7,
        totalElements: 30,
        totalPages: 5,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `shared-expanded-${i + 1}`,
          meta: {
            title: `Shared Expanded ${i + 1}`,
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        })),
        page: 0,
        size: 20,
        totalElements: 30,
        totalPages: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `shared-next-${i + 1}`,
          meta: {
            title: `Shared Next ${i + 1}`,
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        })),
        page: 1,
        size: 20,
        totalElements: 30,
        totalPages: 2,
        hasMore: false,
      });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    act(() => {
      result.current.showAllSharedDocuments();
    });

    await waitFor(() => {
      expect(listSharedDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 20);
      expect(result.current.isShowingAllShared).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.isSharedLoadingMore).toBe(false);
      expect(result.current.sharedDocuments.length).toBe(20);
    });

    await act(async () => {
      await result.current.loadMoreSharedDocuments();
    });

    expect(listSharedDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 7);
    expect(listSharedDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 20);
    expect(listSharedDocumentsSpy).toHaveBeenCalledWith('token-1', 1, 20);
    expect(result.current.sharedDocuments.length).toBe(30);
    expect(result.current.sharedHasMore).toBe(false);
  });

  it('does not report sharedHasMore when only private pagination has more', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    const ownerOnlyCollaborators = [
      {
        userId: 'owner-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        accessLevel: 'OWNER',
        addedAt: '2024-01-01T10:00:00Z',
      },
    ];

    listCloudDocumentsSpy.mockResolvedValue({
      items: Array.from({ length: 7 }, (_, i) => ({
        id: `private-doc-${i + 1}`,
        meta: {
          title: `Private ${i + 1}`,
          updatedAt: '2024-01-01T13:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      })),
      page: 0,
      size: 7,
      totalElements: 12,
      totalPages: 2,
      hasMore: true,
    });

    listSharedDocumentsSpy.mockResolvedValue({
      items: [],
      page: 0,
      size: 7,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });

    listCollaboratorsSpy.mockResolvedValue(ownerOnlyCollaborators);

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.sharedDocuments).toHaveLength(0);
    expect(result.current.sharedHasMore).toBe(false);
  });

  it('reconciles owner-shared split before exposing hasMore', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    const firstPage = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `private-doc-${i + 1}`,
        meta: {
          title: `Private ${i + 1}`,
          updatedAt: '2024-01-01T13:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      })),
      {
        id: 'owner-shared-1',
        meta: {
          title: 'Owner Shared 1',
          updatedAt: '2024-01-01T13:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ];

    const expandedSeedPage = [
      ...firstPage,
      {
        id: 'owner-shared-2',
        meta: {
          title: 'Owner Shared 2',
          updatedAt: '2024-01-01T12:30:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ];

    listCloudDocumentsSpy
      .mockResolvedValueOnce({
        items: firstPage,
        page: 0,
        size: 7,
        totalElements: 8,
        totalPages: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: expandedSeedPage,
        page: 0,
        size: 20,
        totalElements: 8,
        totalPages: 1,
        hasMore: false,
      });

    listSharedDocumentsSpy.mockResolvedValue({
      items: [],
      page: 0,
      size: 7,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });

    listCollaboratorsSpy.mockImplementation(async (documentId: string) => {
      const owner = {
        userId: 'owner-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        accessLevel: 'OWNER',
        addedAt: '2024-01-01T10:00:00Z',
      };

      if (documentId.startsWith('owner-shared-')) {
        return [
          owner,
          {
            userId: 'collab-1',
            email: 'collab@example.com',
            displayName: 'Collaborator',
            accessLevel: 'EDIT',
            addedAt: '2024-01-01T11:00:00Z',
          },
        ];
      }

      return [owner];
    });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 7);
    expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 20);
    expect(result.current.documents).toHaveLength(6);
    expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual([
      'owner-shared-1',
      'owner-shared-2',
    ]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.sharedHasMore).toBe(false);
    expect(result.current.canShowAll).toBe(false);
  });

  it('reports sharedHasMore when owner-shared pagination still has more', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'owner-shared-doc',
          meta: {
            title: 'Owner Shared',
            updatedAt: '2024-01-01T13:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 50,
      totalPages: 8,
      hasMore: true,
    });

    listSharedDocumentsSpy.mockResolvedValue({
      items: [],
      page: 0,
      size: 7,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });

    listCollaboratorsSpy.mockResolvedValue([
      {
        userId: 'owner-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        accessLevel: 'OWNER',
        addedAt: '2024-01-01T10:00:00Z',
      },
      {
        userId: 'collab-1',
        email: 'collab@example.com',
        displayName: 'Collaborator',
        accessLevel: 'EDIT',
        addedAt: '2024-01-01T11:00:00Z',
      },
    ]);

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['owner-shared-doc']);
    expect(result.current.sharedHasMore).toBe(true);
  });

  it('keeps shared documents visible when local changes occur offline', async () => {
    const originalOnLine = window.navigator.onLine;

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'private-doc-1',
          meta: {
            title: 'Private 1',
            updatedAt: '2024-01-01T13:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    listSharedDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'shared-doc-1',
          meta: {
            title: 'Shared 1',
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    getAllDocumentsMetaSpy.mockResolvedValue([
      {
        id: 'private-doc-1',
        meta: {
          title: 'Private 1 (Edited Offline)',
          updatedAt: '2024-01-02T13:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ]);

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });
    await waitFor(() => {
      expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['shared-doc-1']);
    });

    try {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      await act(async () => {
        window.dispatchEvent(new CustomEvent('local-documents-changed'));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['shared-doc-1']);
      });
    } finally {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: originalOnLine,
      });
    }
  });

  it('keeps shared metadata updates out of the private list', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'private-doc-1',
          meta: {
            title: 'Private 1',
            updatedAt: '2024-01-01T13:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    listSharedDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'shared-doc-1',
          meta: {
            title: 'Shared 1',
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    await waitFor(() => {
      expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['shared-doc-1']);
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('document-meta-updated', {
          detail: {
            id: 'shared-doc-1',
            meta: {
              title: 'Shared 1 Renamed',
              updatedAt: '2024-01-02T12:00:00Z',
              createdAt: '2024-01-01T10:00:00Z',
            },
          },
        })
      );
    });

    expect(result.current.documents.map((doc) => doc.id)).toEqual(['private-doc-1']);
    expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['shared-doc-1']);
    expect(result.current.sharedDocuments[0].meta.title).toBe('Shared 1 Renamed');
  });

  it('preserves hasMore when a visible private document metadata update reorders the collapsed list', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: Array.from({ length: 7 }, (_, i) => ({
        id: `private-doc-${i + 1}`,
        meta: {
          title: `Private ${i + 1}`,
          updatedAt: `2024-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
          createdAt: '2024-01-01T10:00:00Z',
        },
      })),
      page: 0,
      size: 7,
      totalElements: 20,
      totalPages: 3,
      hasMore: true,
    });

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.canShowAll).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('document-meta-updated', {
          detail: {
            id: 'private-doc-7',
            meta: {
              title: 'Private 7 Renamed',
              updatedAt: '2024-01-20T12:00:00Z',
              createdAt: '2024-01-01T10:00:00Z',
            },
          },
        })
      );
    });

    expect(result.current.documents[0].id).toBe('private-doc-7');
    expect(result.current.hasMore).toBe(true);
    expect(result.current.canShowAll).toBe(true);
  });

  it('does not surface shared show-all state from private local pagination while offline', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
    });

    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'owner-shared-1',
          meta: {
            title: 'Owner Shared 1',
            updatedAt: '2024-01-02T13:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
        {
          id: 'owner-shared-2',
          meta: {
            title: 'Owner Shared 2',
            updatedAt: '2024-01-02T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 2,
      totalPages: 1,
      hasMore: false,
    });

    listSharedDocumentsSpy.mockResolvedValue({
      items: [],
      page: 0,
      size: 7,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });

    listCollaboratorsSpy.mockResolvedValue([
      {
        userId: 'owner-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        accessLevel: 'OWNER',
        addedAt: '2024-01-01T10:00:00Z',
      },
      {
        userId: 'collab-1',
        email: 'collab@example.com',
        displayName: 'Collaborator',
        accessLevel: 'EDIT',
        addedAt: '2024-01-01T11:00:00Z',
      },
    ]);

    getAllDocumentsMetaSpy.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `local-private-${index + 1}`,
        meta: {
          title: `Local Private ${index + 1}`,
          updatedAt: `2024-01-${String(10 + index).padStart(2, '0')}T10:00:00Z`,
          createdAt: '2024-01-01T10:00:00Z',
        },
      }))
    );

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual([
      'owner-shared-1',
      'owner-shared-2',
    ]);
    expect(result.current.sharedHasMore).toBe(false);

    mockIsCloudInBackoff.mockReturnValue(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('local-documents-changed'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(7);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual([
        'owner-shared-1',
        'owner-shared-2',
      ]);
      expect(result.current.sharedHasMore).toBe(false);
    });
  });

  it('caches cloud-listed private and shared docs locally for offline navigation', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
    });

    getAllDocumentsMetaSpy.mockResolvedValue([]);

    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'private-cloud-1',
          meta: {
            title: 'Private Cloud 1',
            updatedAt: '2024-01-02T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    listSharedDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'shared-cloud-1',
          meta: {
            title: 'Shared Cloud 1',
            updatedAt: '2024-01-02T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    getCloudDocumentSpy.mockImplementation(async (id: string) => ({
      ydoc: new Y.Doc(),
      meta: {
        title: id === 'shared-cloud-1' ? 'Shared Cloud 1' : 'Private Cloud 1',
        updatedAt: '2024-01-02T12:00:00Z',
        createdAt: '2024-01-01T10:00:00Z',
      },
    }));

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });
    await waitFor(() => {
      expect(result.current.documents.map((doc) => doc.id)).toEqual(['private-cloud-1']);
      expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['shared-cloud-1']);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'private-cloud-1',
        expect.any(Y.Doc),
        expect.objectContaining({ title: 'Private Cloud 1' }),
        { touchUpdatedAt: false }
      );
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'shared-cloud-1',
        expect.any(Y.Doc),
        expect.objectContaining({ title: 'Shared Cloud 1' }),
        { touchUpdatedAt: false }
      );
    });
  });

  it('does not duplicate shared-with-me documents in private section when going offline', async () => {
    const originalOnLine = window.navigator.onLine;

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
    });

    // First load: user owns 1 private doc and 1 shared doc (with collaborators)
    listCloudDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'owner-private-1',
          meta: {
            title: 'Owner Private 1',
            updatedAt: '2024-01-01T13:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
        {
          id: 'owner-shared-1',
          meta: {
            title: 'Owner Shared 1',
            updatedAt: '2024-01-01T12:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 2,
      totalPages: 1,
      hasMore: false,
    });

    // Another user shared a doc with this user
    listSharedDocumentsSpy.mockResolvedValue({
      items: [
        {
          id: 'shared-with-me-1',
          meta: {
            title: 'Shared With Me 1',
            updatedAt: '2024-01-01T14:00:00Z',
            createdAt: '2024-01-01T10:00:00Z',
          },
        },
      ],
      page: 0,
      size: 7,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    // Classify: owner-shared-1 has collaborators
    listCollaboratorsSpy.mockImplementation(async (docId: string) => {
      if (docId === 'owner-shared-1') {
        return [
          {
            userId: 'owner-1',
            email: 'owner@example.com',
            displayName: 'Owner',
            accessLevel: 'OWNER',
            addedAt: '2024-01-01T10:00:00Z',
          },
          {
            userId: 'collab-1',
            email: 'collab@example.com',
            displayName: 'Collaborator',
            accessLevel: 'EDIT',
            addedAt: '2024-01-01T11:00:00Z',
          },
        ];
      }
      return [
        {
          userId: 'owner-1',
          email: 'owner@example.com',
          displayName: 'Owner',
          accessLevel: 'OWNER',
          addedAt: '2024-01-01T10:00:00Z',
        },
      ];
    });

    // Local cache has all documents including shared-with-me
    getAllDocumentsMetaSpy.mockResolvedValue([
      {
        id: 'owner-private-1',
        meta: {
          title: 'Owner Private 1',
          updatedAt: '2024-01-01T13:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
      {
        id: 'owner-shared-1',
        meta: {
          title: 'Owner Shared 1',
          updatedAt: '2024-01-01T12:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
      {
        id: 'shared-with-me-1',
        meta: {
          title: 'Shared With Me 1',
          updatedAt: '2024-01-01T14:00:00Z',
          createdAt: '2024-01-01T10:00:00Z',
        },
      },
    ]);

    const { result } = renderHook(() => useDocumentList());

    await waitForInitialLoad(result, { includeShared: true });

    // Online: documents should only have owner-private-1
    await waitFor(() => {
      expect(result.current.documents.map((doc) => doc.id)).toEqual(['owner-private-1']);
      expect(result.current.sharedDocuments.map((doc) => doc.id)).toContain('owner-shared-1');
      expect(result.current.sharedDocuments.map((doc) => doc.id)).toContain('shared-with-me-1');
    });

    try {
      // Go offline - set navigator.onLine to false
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      // Trigger cloud backoff so isCloudUnavailable() returns true
      mockIsCloudInBackoff.mockReturnValue(true);

      // Now trigger a reload which should hit the offline fallback path
      await act(async () => {
        window.dispatchEvent(new CustomEvent('local-documents-changed'));
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        // Private section should NOT contain shared-with-me-1
        const privateDocIds = result.current.documents.map((doc) => doc.id);
        expect(privateDocIds).not.toContain('shared-with-me-1');
        expect(privateDocIds).not.toContain('owner-shared-1');

        // Shared section should still have the shared documents
        const sharedDocIds = result.current.sharedDocuments.map((doc) => doc.id);
        expect(sharedDocIds).toContain('shared-with-me-1');
        expect(sharedDocIds).toContain('owner-shared-1');
      });
    } finally {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: originalOnLine,
      });
    }
  });
});
