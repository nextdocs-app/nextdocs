import {
  buildLocalSearchHits,
  buildMatchSegments,
  formatRelativeSearchTime,
  getRecentDocumentIds,
  isEditorLinkShortcutTarget,
  recordRecentDocumentVisit,
} from '@/lib/search-helpers.util';

describe('search-helpers.util', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('buildMatchSegments', () => {
    it('splits all case-insensitive substring matches', () => {
      expect(buildMatchSegments('API Design and api Specs', 'api')).toEqual([
        { text: 'API', match: true },
        { text: ' Design and ', match: false },
        { text: 'api', match: true },
        { text: ' Specs', match: false },
      ]);
    });

    it('returns plain segment when query is blank', () => {
      expect(buildMatchSegments('Hello', '   ')).toEqual([{ text: 'Hello', match: false }]);
    });
  });

  describe('recent document storage', () => {
    it('records visits deduplicated and most-recent first per user', () => {
      recordRecentDocumentVisit('user-1', 'doc-a');
      recordRecentDocumentVisit('user-1', 'doc-b');
      recordRecentDocumentVisit('user-1', 'doc-a');
      recordRecentDocumentVisit('user-2', 'doc-c');

      expect(getRecentDocumentIds('user-1')).toEqual(['doc-a', 'doc-b']);
      expect(getRecentDocumentIds('user-2')).toEqual(['doc-c']);
    });
  });

  describe('formatRelativeSearchTime', () => {
    it('formats recent intervals cleanly', () => {
      const now = Date.now();
      expect(formatRelativeSearchTime(new Date(now - 20_000).toISOString())).toBe(
        'Edited just now'
      );
      expect(formatRelativeSearchTime(new Date(now - 5 * 60_000).toISOString())).toBe(
        'Edited 5m ago'
      );
      expect(formatRelativeSearchTime(new Date(now - 3 * 3600_000).toISOString())).toBe(
        'Edited 3h ago'
      );
      expect(formatRelativeSearchTime(new Date(now - 25 * 3600_000).toISOString())).toBe(
        'Edited yesterday'
      );
      expect(formatRelativeSearchTime(null)).toBe('');
    });
  });

  describe('buildLocalSearchHits', () => {
    it('orders recent documents first when query is empty and excludes trashed documents', () => {
      const hits = buildLocalSearchHits({
        documents: [
          {
            id: 'doc-old',
            meta: {
              title: 'Older Page',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
          {
            id: 'doc-new',
            meta: {
              title: 'Newer Page',
              createdAt: '2026-05-01T00:00:00Z',
              updatedAt: '2026-05-01T00:00:00Z',
            },
          },
          {
            id: 'doc-trashed',
            meta: {
              title: 'Deleted Page',
              createdAt: '2026-06-01T00:00:00Z',
              updatedAt: '2026-06-01T00:00:00Z',
            },
          },
        ],
        trashedDocuments: [
          {
            id: 'doc-trashed',
            meta: {
              title: 'Deleted Page',
              createdAt: '2026-06-01T00:00:00Z',
              updatedAt: '2026-06-01T00:00:00Z',
            },
          },
        ],
        recentIds: ['doc-old'],
        query: '',
      });

      expect(hits.map((hit) => hit.documentId)).toEqual(['doc-old', 'doc-new']);
    });

    it('resolves space and breadcrumb ancestors and ranks prefix matches first', () => {
      const hits = buildLocalSearchHits({
        documents: [],
        spaceTrees: {
          'space-1': {
            isRootLoading: false,
            rootIds: ['parent-1'],
            nodes: {
              'parent-1': {
                id: 'parent-1',
                title: 'Engineering',
                parentId: null,
                orderKey: 'a0',
                hasChildren: true,
                effectiveAccessLevel: 'EDIT',
                isExpanded: true,
                isLoading: false,
                children: ['child-1'],
                childrenLoaded: true,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
              'child-1': {
                id: 'child-1',
                title: 'Search Architecture',
                parentId: 'parent-1',
                orderKey: 'a0',
                hasChildren: false,
                effectiveAccessLevel: 'EDIT',
                isExpanded: false,
                isLoading: false,
                children: [],
                childrenLoaded: true,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-02-01T00:00:00Z',
              },
              'other-1': {
                id: 'other-1',
                title: 'Deep Search Notes',
                parentId: null,
                orderKey: 'a1',
                hasChildren: false,
                effectiveAccessLevel: 'EDIT',
                isExpanded: false,
                isLoading: false,
                children: [],
                childrenLoaded: true,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-03-01T00:00:00Z',
              },
            },
          },
        },
        spaces: {
          'space-1': { id: 'space-1', name: 'Core Team', icon: null },
        },
        query: 'Search',
      });

      expect(hits.map((hit) => hit.documentId)).toEqual(['child-1', 'other-1']);
      expect(hits[0].space).toEqual({ id: 'space-1', name: 'Core Team' });
      expect(hits[0].breadcrumb).toEqual([{ id: 'parent-1', title: 'Engineering' }]);
      expect(hits[0].title).toEqual([
        { text: 'Search', match: true },
        { text: ' Architecture', match: false },
      ]);
    });
  });

  describe('isEditorLinkShortcutTarget', () => {
    function addEditable() {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      editable.appendChild(child);
      document.body.appendChild(editable);
      return child;
    }

    afterEach(() => {
      jest.restoreAllMocks();
      document.body.innerHTML = '';
    });

    it('yields Mod+K when text is selected inside an editable', () => {
      const child = addEditable();
      jest.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);

      expect(isEditorLinkShortcutTarget(child)).toBe(true);
      expect(isEditorLinkShortcutTarget(document.body)).toBe(false);
    });

    it('does not yield when the caret is collapsed', () => {
      const child = addEditable();
      jest.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true } as Selection);

      expect(isEditorLinkShortcutTarget(child)).toBe(false);
    });

    it('does not yield outside editable surfaces', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);
      jest.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);

      expect(isEditorLinkShortcutTarget(button)).toBe(false);
    });
  });
});
