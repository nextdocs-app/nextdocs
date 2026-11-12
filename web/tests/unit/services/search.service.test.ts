import { apiRequest } from '../../../services/api-client';
import { searchService } from '../../../services/search.service';

jest.mock('../../../services/api-client', () => {
  const actual = jest.requireActual('../../../services/api-client');
  return {
    ...actual,
    apiRequest: jest.fn(),
  };
});

describe('searchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls /api/v1/search with encoded query, pagination, auth header, and normalizes hits', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      query: 'roadmap q4',
      items: [
        {
          documentId: 'doc-1',
          title: [
            { text: 'Product ', match: false },
            { text: 'Roadmap', match: true },
          ],
          snippet: [{ text: 'Q4 milestones', match: true }],
          breadcrumb: [{ id: 'root-1', title: 'Engineering' }],
          space: { id: 'space-1', name: 'Core' },
          icon: { type: 'emoji', value: '🚀', color: null },
          updatedAt: '2026-10-01T12:00:00Z',
        },
        {
          documentId: 'doc-2',
          title: null,
          snippet: null,
          breadcrumb: null,
          space: null,
          // Invalid icon value should be dropped by sanitizeDocumentIcon
          icon: { type: 'link', value: 'javascript:alert(1)' },
          updatedAt: null,
        },
      ],
      hasMore: true,
      nextOffset: 20,
    });

    const controller = new AbortController();
    const result = await searchService.search('jwt-token', 'roadmap q4', {
      limit: 20,
      offset: 0,
      signal: controller.signal,
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/search?q=roadmap+q4&limit=20&offset=0', {
      method: 'GET',
      headers: { Authorization: 'Bearer jwt-token' },
      signal: controller.signal,
    });
    expect(result).toEqual({
      query: 'roadmap q4',
      hasMore: true,
      nextOffset: 20,
      items: [
        {
          documentId: 'doc-1',
          title: [
            { text: 'Product ', match: false },
            { text: 'Roadmap', match: true },
          ],
          snippet: [{ text: 'Q4 milestones', match: true }],
          breadcrumb: [{ id: 'root-1', title: 'Engineering' }],
          space: { id: 'space-1', name: 'Core' },
          icon: { type: 'emoji', value: '🚀' },
          updatedAt: '2026-10-01T12:00:00Z',
        },
        {
          documentId: 'doc-2',
          title: [],
          snippet: [],
          breadcrumb: [],
          space: null,
          icon: null,
          updatedAt: null,
        },
      ],
    });
  });

  it('advances the fallback offset from the requested page', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      query: 'x',
      items: [
        {
          documentId: 'doc-1',
          title: [],
          snippet: [],
          breadcrumb: [],
          space: null,
          icon: null,
          updatedAt: null,
        },
      ],
      hasMore: true,
      // nextOffset deliberately absent: the client has to derive the next page start from
      // the page it asked for, not from the size of the page that came back.
    });

    const result = await searchService.search('jwt-token', 'x', { limit: 20, offset: 40 });

    expect(result.nextOffset).toBe(41);
  });

  it('drops malformed hits and segments instead of rendering them', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      query: 'x',
      items: [
        null,
        { title: [] },
        {
          documentId: 'doc-9',
          title: [{ text: 'Kept' }, null, { match: true }, { text: 42 }],
          snippet: 'not-an-array',
          breadcrumb: [{ title: 'No id' }, { id: 'p1' }],
          space: { id: 's1' },
        },
      ],
      hasMore: false,
      nextOffset: 1,
    });

    const result = await searchService.search('jwt-token', 'x');

    expect(result.items).toEqual([
      {
        documentId: 'doc-9',
        title: [{ text: 'Kept', match: false }],
        snippet: [],
        breadcrumb: [{ id: 'p1', title: 'Untitled' }],
        space: null,
        icon: null,
        updatedAt: null,
      },
    ]);
  });
});
