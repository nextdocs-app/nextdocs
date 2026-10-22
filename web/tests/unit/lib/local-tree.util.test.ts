import {
  clearLocalDocumentParent,
  getLocalDocumentParents,
  setLocalDocumentParent,
  setLocalDocumentParents,
} from '@/lib/local-tree.util';

describe('local-tree.util', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('records and reads parent links', () => {
    setLocalDocumentParent('child', 'parent');
    setLocalDocumentParent('root', null);

    const parents = getLocalDocumentParents();

    expect(parents.get('child')).toBe('parent');
    expect(parents.get('root')).toBeNull();
  });

  it('records a cloud hierarchy in one batch, roots included', () => {
    setLocalDocumentParents([
      { id: 'parent', parentId: null },
      { id: 'child', parentId: 'parent' },
      { id: 'grandchild', parentId: 'child' },
    ]);

    const parents = getLocalDocumentParents();

    expect(parents.get('parent')).toBeNull();
    expect(parents.get('child')).toBe('parent');
    expect(parents.get('grandchild')).toBe('child');
  });

  it('overwrites the parent when a document moves', () => {
    setLocalDocumentParent('child', 'parent-a');
    setLocalDocumentParent('child', 'parent-b');

    expect(getLocalDocumentParents().get('child')).toBe('parent-b');
  });

  it('drops a link once the document is gone', () => {
    setLocalDocumentParent('child', 'parent');

    clearLocalDocumentParent('child');
    clearLocalDocumentParent('unknown');

    expect(getLocalDocumentParents().has('child')).toBe(false);
  });

  it('ignores an unreadable map instead of throwing during a reload', () => {
    window.localStorage.setItem('nextdocs:local-document-parents', '{not json');

    expect(getLocalDocumentParents().size).toBe(0);

    setLocalDocumentParent('child', 'parent');
    expect(getLocalDocumentParents().get('child')).toBe('parent');
  });

  it('skips entries whose parent is neither a string nor null', () => {
    window.localStorage.setItem(
      'nextdocs:local-document-parents',
      JSON.stringify({ ok: 'parent', nulled: null, broken: 42 })
    );

    const parents = getLocalDocumentParents();

    expect([...parents.keys()].sort()).toEqual(['nulled', 'ok']);
  });

  it('removes the storage key when the last link is cleared', () => {
    setLocalDocumentParent('child', 'parent');
    clearLocalDocumentParent('child');

    expect(window.localStorage.getItem('nextdocs:local-document-parents')).toBeNull();
  });

  it('keeps working when localStorage refuses the parent write', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    try {
      expect(() => setLocalDocumentParent('child', 'parent')).not.toThrow();

      // The tree loses its nesting until the next successful write; the
      // document itself is still safe in IndexedDB.
      expect(getLocalDocumentParents().has('child')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to persist local document parents:',
        expect.any(Error)
      );
    } finally {
      setItemSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
