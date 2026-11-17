import { act, renderHook } from '@testing-library/react';
import * as Y from '@y/y';
import {
  useDocumentYjsMetaSync,
  type DocumentYjsMetaSyncRefs,
} from '@/hooks/useDocumentYjsMetaSync.hook';
import {
  YJS_META_COVER_KEY,
  YJS_META_ICON_KEY,
  YJS_META_MAP_KEY,
  YJS_META_TITLE_KEY,
} from '@/lib/document-meta-sync.util';
import { getYjsStringMap } from '@/lib/yjs.util';
import { dispatchDocumentMetaUpdated } from '@/lib/document-meta-event.util';
import type { DocumentMeta } from '@/types/document.types';

jest.mock('../../../lib/document-meta-event.util', () => ({
  dispatchDocumentMetaUpdated: jest.fn(),
}));

const dispatchMock = dispatchDocumentMetaUpdated as jest.MockedFunction<
  typeof dispatchDocumentMetaUpdated
>;

const documentId = '44444444-4444-4444-8444-444444444444';

const icon: DocumentMeta['icon'] = { type: 'emoji', value: '🚀' };
const cover: DocumentMeta['cover'] = {
  type: 'link',
  value: 'https://images.example.com/cover.png',
  position: 0.5,
};

function baseMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    title: 'Roadmap',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type MetaAction = {
  type: string;
  payload: Partial<DocumentMeta> & { updatedAt: string };
};

/**
 * Renders the hook over a real Yjs doc. `seed` writes the shared map before the
 * hook mounts, the way a collaborator's earlier transaction would have.
 */
function setup(options: {
  meta: DocumentMeta;
  seed?: (map: ReturnType<typeof getYjsStringMap>) => void;
  refs?: Partial<DocumentYjsMetaSyncRefs>;
  /** VIEW/COMMENT skips the seeder, like a real read-only participant. */
  accessLevel?: 'VIEW' | 'COMMENT' | 'EDIT';
}) {
  const accessLevel = options.accessLevel ?? 'EDIT';
  const ydoc = new Y.Doc();
  if (options.seed) {
    options.seed(getYjsStringMap(ydoc, YJS_META_MAP_KEY));
  }

  const dispatch = jest.fn();
  const refs: DocumentYjsMetaSyncRefs = {
    accessLevelRef: { current: accessLevel },
    accessResolvedRef: { current: true },
    metaRef: { current: options.meta },
    lastLocalTitleRef: { current: null },
    lastLocalIconRef: { current: undefined },
    lastLocalCoverRef: { current: undefined },
    resolvedDocumentIdRef: { current: documentId },
    ...options.refs,
  };

  const rendered = renderHook(() =>
    useDocumentYjsMetaSync({
      ydoc,
      resolvedDocumentId: documentId,
      meta: options.meta,
      accessLevel,
      accessResolved: true,
      dispatch: dispatch as never,
      refs,
    })
  );

  return { ydoc, dispatch, refs, ...rendered };
}

function metaMapOf(ydoc: Y.Doc) {
  return getYjsStringMap(ydoc, YJS_META_MAP_KEY);
}

/** The updateMeta action the observer dispatched, or undefined. */
function metaAction(dispatch: jest.Mock): MetaAction | undefined {
  const call = dispatch.mock.calls.find(([action]) =>
    (action as MetaAction).type.endsWith('/updateMeta')
  );
  return call ? (call[0] as MetaAction) : undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useDocumentYjsMetaSync observer', () => {
  it('removes the icon when the shared transaction deletes it', () => {
    const { ydoc, dispatch, refs } = setup({
      meta: baseMeta({ icon }),
      seed: (map) => {
        map.set(YJS_META_TITLE_KEY, 'Roadmap');
        map.set(YJS_META_ICON_KEY, JSON.stringify(icon));
      },
    });

    act(() => {
      metaMapOf(ydoc).delete(YJS_META_ICON_KEY);
    });

    const action = metaAction(dispatch);
    expect(action?.payload).toMatchObject({ icon: undefined, updatedAt: expect.any(String) });
    // The delete must not be mistaken for a title change.
    expect(action?.payload).not.toHaveProperty('title');
    expect(refs.metaRef.current?.icon).toEqual(icon);
    expect(dispatchDocumentMetaUpdated).toHaveBeenCalledWith(
      documentId,
      expect.objectContaining({ icon: undefined, title: 'Roadmap' })
    );
  });

  it('removes the cover when the shared transaction deletes it', () => {
    const { ydoc, dispatch } = setup({
      meta: baseMeta({ cover }),
      seed: (map) => {
        map.set(YJS_META_TITLE_KEY, 'Roadmap');
        map.set(YJS_META_COVER_KEY, JSON.stringify(cover));
      },
    });

    act(() => {
      metaMapOf(ydoc).delete(YJS_META_COVER_KEY);
    });

    const action = metaAction(dispatch);
    expect(action?.payload).toMatchObject({ cover: undefined, updatedAt: expect.any(String) });
    expect(action?.payload).not.toHaveProperty('icon');
    expect(dispatchDocumentMetaUpdated).toHaveBeenCalledTimes(1);
  });

  it('applies a set as a value, never as a delete of the other keys', () => {
    const { ydoc, dispatch } = setup({
      meta: baseMeta(),
      seed: (map) => {
        map.set(YJS_META_TITLE_KEY, 'Roadmap');
      },
    });

    act(() => {
      metaMapOf(ydoc).set(YJS_META_TITLE_KEY, 'Renamed');
    });

    const action = metaAction(dispatch);
    expect(action?.payload).toMatchObject({ title: 'Renamed', updatedAt: expect.any(String) });
    // The transaction touched only `title`; icon/cover were never set, so their
    // absence must not read as a delete that clears a local value.
    expect(action?.payload).not.toHaveProperty('icon');
    expect(action?.payload).not.toHaveProperty('cover');
  });

  it('does not clear a locally present icon on a title-only transaction', () => {
    // A read-only participant never seeds the map, so its icon exists only
    // locally. A title edit from someone else must not read as an icon delete
    // just because the map has no icon attribute.
    const { ydoc, dispatch } = setup({
      meta: baseMeta({ icon }),
      accessLevel: 'VIEW',
      seed: (map) => {
        map.set(YJS_META_TITLE_KEY, 'Roadmap');
      },
    });

    act(() => {
      metaMapOf(ydoc).set(YJS_META_TITLE_KEY, 'Renamed');
    });

    const action = metaAction(dispatch);
    expect(action?.payload).toMatchObject({ title: 'Renamed' });
    expect(action?.payload).not.toHaveProperty('icon');
    expect(action?.payload).not.toHaveProperty('cover');
  });

  it('applies a remote icon and cover set without dropping the title', () => {
    const { ydoc, dispatch } = setup({
      meta: baseMeta(),
      seed: (map) => {
        map.set(YJS_META_TITLE_KEY, 'Roadmap');
      },
    });

    act(() => {
      metaMapOf(ydoc).set(YJS_META_ICON_KEY, JSON.stringify(icon));
    });

    const action = metaAction(dispatch);
    expect(action?.payload).toMatchObject({ icon, updatedAt: expect.any(String) });
    expect(action?.payload).not.toHaveProperty('title');
  });

  it('ignores an invalid icon payload instead of rendering it', () => {
    const { ydoc, dispatch } = setup({
      meta: baseMeta(),
      seed: (map) => {
        map.set(YJS_META_TITLE_KEY, 'Roadmap');
      },
    });

    act(() => {
      metaMapOf(ydoc).set(YJS_META_ICON_KEY, 'not-json');
    });

    expect(metaAction(dispatch)).toBeUndefined();
    expect(dispatchDocumentMetaUpdated).not.toHaveBeenCalled();
  });

  it('stops observing once the document is unmounted', () => {
    const { ydoc, dispatch, unmount } = setup({
      meta: baseMeta(),
      seed: (map) => {
        map.set(YJS_META_TITLE_KEY, 'Roadmap');
      },
    });

    unmount();

    act(() => {
      metaMapOf(ydoc).set(YJS_META_TITLE_KEY, 'Renamed');
    });

    expect(metaAction(dispatch)).toBeUndefined();
  });
});
