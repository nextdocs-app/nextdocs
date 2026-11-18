import * as Y from '@y/y';
import {
  clearPreservedLocalCopy,
  preserveStaleLocalCopy,
  readPreservedLocalCopy,
} from '@/lib/stale-local-copy.util';

function docWithBody(text: string): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.get('body').insert(0, [text]);
  return ydoc;
}

function meta(title: string) {
  return {
    title,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
}

describe('stale-local-copy.util', () => {
  afterEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('keeps the local copy so a recovery can decode it back', () => {
    expect(
      preserveStaleLocalCopy({ documentId: 'doc-1', ydoc: docWithBody('hello'), meta: meta('Doc') })
    ).toBe(true);

    const preserved = readPreservedLocalCopy('doc-1');
    expect(preserved?.meta.title).toBe('Doc');
    expect(JSON.stringify(preserved?.ydoc.get('body').toDelta() ?? '')).toContain('hello');
    expect(preserved?.ydoc).toBeInstanceOf(Y.Doc);
    expect(Number.isNaN(Date.parse(preserved?.savedAt ?? ''))).toBe(false);
  });

  it('replaces an older copy for the same document', () => {
    preserveStaleLocalCopy({
      documentId: 'doc-1',
      ydoc: docWithBody('first'),
      meta: meta('First'),
    });
    preserveStaleLocalCopy({
      documentId: 'doc-1',
      ydoc: docWithBody('second'),
      meta: meta('Second'),
    });

    const preserved = readPreservedLocalCopy('doc-1');
    expect(preserved?.meta.title).toBe('Second');
    expect(JSON.stringify(preserved?.ydoc.get('body').toDelta() ?? '')).toContain('second');
  });

  it('reports whether a copy was stored when clearing it', () => {
    expect(clearPreservedLocalCopy('doc-1')).toBe(false);

    preserveStaleLocalCopy({ documentId: 'doc-1', ydoc: docWithBody('hello'), meta: meta('Doc') });
    expect(clearPreservedLocalCopy('doc-1')).toBe(true);
    expect(readPreservedLocalCopy('doc-1')).toBeNull();
  });

  it('keeps documents apart', () => {
    preserveStaleLocalCopy({ documentId: 'doc-1', ydoc: docWithBody('one'), meta: meta('One') });
    preserveStaleLocalCopy({ documentId: 'doc-2', ydoc: docWithBody('two'), meta: meta('Two') });

    expect(
      JSON.stringify(readPreservedLocalCopy('doc-1')?.ydoc.get('body').toDelta() ?? '')
    ).toContain('one');
    expect(
      JSON.stringify(readPreservedLocalCopy('doc-2')?.ydoc.get('body').toDelta() ?? '')
    ).toContain('two');
  });

  it('reports a copy it could not store instead of claiming it was kept', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      preserveStaleLocalCopy({ documentId: 'doc-1', ydoc: docWithBody('hello'), meta: meta('Doc') })
    ).toBe(false);
  });

  it('ignores an entry it cannot decode', () => {
    window.localStorage.setItem('nextdocs:stale-local-copy:doc-1', '{"yjsState":"%%%"}');
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readPreservedLocalCopy('doc-1')).toBeNull();
  });
});
