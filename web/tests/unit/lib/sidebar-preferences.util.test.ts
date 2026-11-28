import {
  DEFAULT_SIDEBAR_UI_PREFERENCES,
  MAX_REMEMBERED_DOCUMENTS,
  MAX_REMEMBERED_SPACES,
  SIDEBAR_COLLAPSED_ATTRIBUTE,
  SIDEBAR_PREFERENCES_BOOTSTRAP_SCRIPT,
  SIDEBAR_PREFERENCES_VERSION,
  SIDEBAR_TREE_PREFERENCE_KEY_PREFIX,
  SIDEBAR_UI_PREFERENCE_KEY,
  applySidebarCollapsedAttribute,
  defaultSidebarUiPreferences,
  emptySidebarTreePreferences,
  mergeExpandedIds,
  parseSidebarTreePreferences,
  parseSidebarUiPreferences,
  sidebarTreePreference,
  sidebarUiPreference,
} from '../../../lib/sidebar-preferences.util';

const uiPayload = (payload: Record<string, unknown>) => ({
  v: SIDEBAR_PREFERENCES_VERSION,
  ...payload,
});

describe('sidebar UI preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE);
  });

  it('defaults to an expanded rail with every section open', () => {
    expect(sidebarUiPreference.read()).toEqual(DEFAULT_SIDEBAR_UI_PREFERENCES);
  });

  it('round-trips the collapse and section flags', () => {
    sidebarUiPreference.set({
      collapsed: true,
      sections: { spaces: false, private: true, shared: false },
    });

    expect(sidebarUiPreference.read()).toEqual({
      collapsed: true,
      sections: { spaces: false, private: true, shared: false },
    });
  });

  it('requires the sections object so a partial payload cannot silently reset it', () => {
    expect(parseSidebarUiPreferences(uiPayload({ collapsed: true }))).toBeNull();
  });

  it('reads non-boolean flags as their defaults', () => {
    expect(
      parseSidebarUiPreferences(uiPayload({ collapsed: 'yes', sections: { private: 1 } }))
    ).toEqual({
      collapsed: false,
      sections: { spaces: true, private: true, shared: true },
    });
  });
});

describe('sidebar tree preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps only usable ids and never writes duplicates', () => {
    expect(
      parseSidebarTreePreferences({
        documents: ['doc-1', '', 7, null, 'doc-1', 'doc-2'],
        spaces: ['space-1', 'space-1'],
      })
    ).toEqual({ documents: ['doc-1', 'doc-2'], spaces: ['space-1'] });
  });

  it('reads a list that is not an array as empty', () => {
    expect(parseSidebarTreePreferences({ documents: 'doc-1', spaces: 7 })).toEqual({
      documents: [],
      spaces: [],
    });
  });

  it('returns fresh defaults on every call', () => {
    const firstUi = defaultSidebarUiPreferences();
    firstUi.sections.spaces = false;
    expect(defaultSidebarUiPreferences().sections.spaces).toBe(true);

    const firstTree = emptySidebarTreePreferences();
    firstTree.documents.push('doc-1');
    expect(emptySidebarTreePreferences().documents).toEqual([]);
  });

  it('caps what it accepts from storage', () => {
    const documents = Array.from({ length: MAX_REMEMBERED_DOCUMENTS + 10 }, (_, i) => `doc-${i}`);
    const spaces = Array.from({ length: MAX_REMEMBERED_SPACES + 10 }, (_, i) => `space-${i}`);

    const parsed = parseSidebarTreePreferences({ documents, spaces });

    expect(parsed.documents).toHaveLength(MAX_REMEMBERED_DOCUMENTS);
    expect(parsed.spaces).toHaveLength(MAX_REMEMBERED_SPACES);
  });

  it('scopes the key to the account, with a guest fallback', () => {
    expect(sidebarTreePreference('user-1').key).toBe(`${SIDEBAR_TREE_PREFERENCE_KEY_PREFIX}user-1`);
    expect(sidebarTreePreference(null).key).toBe(`${SIDEBAR_TREE_PREFERENCE_KEY_PREFIX}guest`);
    expect(sidebarTreePreference(undefined).key).toBe(`${SIDEBAR_TREE_PREFERENCE_KEY_PREFIX}guest`);
    // One store per identity, or two subscribers would fight over the same key.
    expect(sidebarTreePreference('user-1')).toBe(sidebarTreePreference('user-1'));
  });
});

describe('mergeExpandedIds', () => {
  it('drops a page that is loaded but no longer expanded', () => {
    expect(
      mergeExpandedIds(['doc-1', 'doc-2'], new Set(['doc-2']), new Set(['doc-1', 'doc-2']), 10)
    ).toEqual(['doc-2']);
  });

  it('keeps a page whose branch has not loaded yet', () => {
    // Nothing is loaded right after a reload: erasing here would forget
    // everything the reader had open.
    expect(mergeExpandedIds(['doc-1'], new Set(), new Set(), 10)).toEqual(['doc-1']);
  });

  it('appends newly expanded pages so the cap evicts the oldest', () => {
    expect(mergeExpandedIds(['doc-1', 'doc-2'], new Set(['doc-2', 'doc-3']), new Set(), 2)).toEqual(
      ['doc-2', 'doc-3']
    );
  });

  it('does not duplicate an id that was already remembered', () => {
    expect(mergeExpandedIds(['doc-1'], new Set(['doc-1']), new Set(['doc-1']), 10)).toEqual([
      'doc-1',
    ]);
  });

  it('deduplicates a malformed previous list', () => {
    expect(mergeExpandedIds(['doc-1', 'doc-1'], new Set(['doc-1']), new Set(), 10)).toEqual([
      'doc-1',
    ]);
  });
});

describe('SIDEBAR_PREFERENCES_BOOTSTRAP_SCRIPT', () => {
  const runBootstrap = () => {
    document.documentElement.removeAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE);
    eval(SIDEBAR_PREFERENCES_BOOTSTRAP_SCRIPT);
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.documentElement.removeAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE);
  });

  it('hides the rail before React runs when it was collapsed', () => {
    localStorage.setItem(
      SIDEBAR_UI_PREFERENCE_KEY,
      JSON.stringify({
        v: 1,
        collapsed: true,
        sections: { spaces: true, private: true, shared: true },
      })
    );

    runBootstrap();

    expect(document.documentElement.getAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe('collapsed');
  });

  it('leaves the rail alone when it was expanded', () => {
    localStorage.setItem(
      SIDEBAR_UI_PREFERENCE_KEY,
      JSON.stringify({
        v: 1,
        collapsed: false,
        sections: { spaces: true, private: true, shared: true },
      })
    );

    runBootstrap();

    expect(document.documentElement.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it('paints the default when nothing is stored', () => {
    runBootstrap();
    expect(document.documentElement.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it('ignores a payload from another version', () => {
    localStorage.setItem(SIDEBAR_UI_PREFERENCE_KEY, JSON.stringify({ v: 0, collapsed: true }));
    runBootstrap();
    expect(document.documentElement.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it('leaves the rail expanded when storage is unreadable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(() => runBootstrap()).not.toThrow();
    expect(document.documentElement.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it('leaves the rail expanded for a payload that is not JSON', () => {
    localStorage.setItem(SIDEBAR_UI_PREFERENCE_KEY, '{"v":1,');

    expect(() => runBootstrap()).not.toThrow();
    expect(document.documentElement.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe(false);
  });
});

describe('applySidebarCollapsedAttribute', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE);
  });

  it('sets and clears the signal CSS paints from', () => {
    applySidebarCollapsedAttribute(true);
    expect(document.documentElement.getAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe('collapsed');

    applySidebarCollapsedAttribute(false);
    expect(document.documentElement.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe(false);
  });
});
