import { renderHook, waitFor, act } from '@testing-library/react';
import { useLocalDocuments } from '@/hooks/useLocalDocuments.hook';
import { documentService } from '@/services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(() => ({
    isAuthenticated: false,
    accessToken: null,
  })),
}));

describe('useLocalDocuments', () => {
  let getAllDocumentsMetaSpy: jest.SpyInstance;
  let listCloudDocumentsSpy: jest.SpyInstance;
  let listSharedDocumentsSpy: jest.SpyInstance;
  let listCollaboratorsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getAllDocumentsMetaSpy = jest.spyOn(documentService, 'getAllDocumentsMeta');
    listCloudDocumentsSpy = jest.spyOn(documentService, 'listCloudDocuments');
    listSharedDocumentsSpy = jest.spyOn(documentService, 'listSharedDocuments');
    listCollaboratorsSpy = jest.spyOn(documentService, 'listCollaborators');

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(listCloudDocumentsSpy).toHaveBeenCalledWith('token-1', 0, 7);
    expect(result.current.documents[0].id).toBe('cloud-1');
    expect(result.current.canShowAll).toBe(true);
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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

    const { result } = renderHook(() => useLocalDocuments());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sharedDocuments.map((doc) => doc.id)).toEqual(['owner-shared-doc']);
    expect(result.current.sharedHasMore).toBe(true);
  });
});
