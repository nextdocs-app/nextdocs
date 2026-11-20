/**
 * The rail's remembered state: shape, storage keys and the pre-paint script.
 *
 * Two preferences, because they answer to different owners:
 *
 * - `nextdocs:sidebar:ui` is device chrome (is the rail closed, which sections
 *   are unfolded). It is tiny and must be readable in `<head>`, so it stays on
 *   the device instead of following the account.
 * - `nextdocs:sidebar:tree:<userId|guest>` is which pages and spaces are
 *   unfolded. The ids are account-scoped, so the key is too; the guest key
 *   mirrors `nextdocs:recent-docs:guest`.
 *
 * Both are plain JSON through `createPreferenceStore`, which is what makes a
 * later "same sidebar on every device" change an upload of the same blob rather
 * than a rewrite.
 */

import { createPreferenceStore, type PreferenceStore } from '@/lib/preference-store.util';

export const SIDEBAR_UI_PREFERENCE_KEY = 'nextdocs:sidebar:ui';
export const SIDEBAR_TREE_PREFERENCE_KEY_PREFIX = 'nextdocs:sidebar:tree:';
export const SIDEBAR_PREFERENCES_VERSION = 1;

/** The attribute the head script sets on `<html>`; CSS paints from it. */
export const SIDEBAR_COLLAPSED_ATTRIBUTE = 'data-nd-sidebar';

/**
 * Safety valves, not budgets: expansion is remembered so that a reload feels
 * like nothing moved, and a user who has unfolded thousands of pages has
 * already lost that race. Evicting the oldest keeps storage bounded.
 */
export const MAX_REMEMBERED_DOCUMENTS = 400;
export const MAX_REMEMBERED_SPACES = 40;

export interface SidebarSections {
  spaces: boolean;
  private: boolean;
  shared: boolean;
}

export interface SidebarUiPreferences {
  collapsed: boolean;
  sections: SidebarSections;
}

export interface SidebarTreePreferences {
  documents: string[];
  spaces: string[];
}

export function defaultSidebarUiPreferences(): SidebarUiPreferences {
  return { collapsed: false, sections: { spaces: true, private: true, shared: true } };
}

export const DEFAULT_SIDEBAR_UI_PREFERENCES: SidebarUiPreferences = defaultSidebarUiPreferences();

export function emptySidebarTreePreferences(): SidebarTreePreferences {
  return { documents: [], spaces: [] };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asIdList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    ids.push(entry);
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
}

export function parseSidebarUiPreferences(
  payload: Record<string, unknown>
): SidebarUiPreferences | null {
  const sections = payload.sections;
  if (!sections || typeof sections !== 'object') {
    return null;
  }

  const record = sections as Record<string, unknown>;
  return {
    collapsed: asBoolean(payload.collapsed, false),
    sections: {
      spaces: asBoolean(record.spaces, true),
      private: asBoolean(record.private, true),
      shared: asBoolean(record.shared, true),
    },
  };
}

export function parseSidebarTreePreferences(
  payload: Record<string, unknown>
): SidebarTreePreferences {
  return {
    documents: asIdList(payload.documents, MAX_REMEMBERED_DOCUMENTS),
    spaces: asIdList(payload.spaces, MAX_REMEMBERED_SPACES),
  };
}

export const sidebarUiPreference: PreferenceStore<SidebarUiPreferences> = createPreferenceStore({
  key: SIDEBAR_UI_PREFERENCE_KEY,
  version: SIDEBAR_PREFERENCES_VERSION,
  defaults: defaultSidebarUiPreferences,
  parse: parseSidebarUiPreferences,
  encode: (value) => ({ collapsed: value.collapsed, sections: { ...value.sections } }),
});

const treePreferences = new Map<string, PreferenceStore<SidebarTreePreferences>>();

/** One store per identity: the expanded ids belong to the account, not the device. */
export function sidebarTreePreference(
  userId: string | null | undefined
): PreferenceStore<SidebarTreePreferences> {
  const scope = userId && userId.length > 0 ? userId : 'guest';
  const existing = treePreferences.get(scope);
  if (existing) {
    return existing;
  }

  const store = createPreferenceStore<SidebarTreePreferences>({
    key: `${SIDEBAR_TREE_PREFERENCE_KEY_PREFIX}${scope}`,
    version: SIDEBAR_PREFERENCES_VERSION,
    defaults: emptySidebarTreePreferences,
    parse: parseSidebarTreePreferences,
    encode: (value) => ({ documents: value.documents, spaces: value.spaces }),
  });
  treePreferences.set(scope, store);
  return store;
}

/**
 * Recency-ordered list of the ids that are expanded now.
 *
 * `loadedIds` is what makes this safe to run before the trees exist: an id that
 * is still loaded but no longer expanded was collapsed by the user and must be
 * forgotten, while an id that is not loaded at all (its branch was never
 * fetched this session, or the rail has not mounted) is unknown and is kept.
 * Without that split, the first persistence pass after a reload, when every
 * tree is still empty, would erase everything.
 *
 * Ids that became expanded since the previous pass are appended, so the cap
 * evicts the pages the user unfolded longest ago.
 */
export function mergeExpandedIds(
  previous: readonly string[],
  expandedNow: ReadonlySet<string>,
  loadedIds: ReadonlySet<string>,
  limit: number
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const id of previous) {
    if (seen.has(id)) {
      continue;
    }
    if (expandedNow.has(id) || !loadedIds.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }

  for (const id of expandedNow) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(id);
  }

  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

/**
 * Runs in `<head>` before the body paints. The rail is unmounted in React when
 * it is collapsed, but React has not run yet, so the server's expanded markup
 * would paint first and then vanish. Resolving the stored flag into an
 * attribute lets CSS hide the rail on the first frame, and the React state then
 * catches up in an effect without changing what is on screen.
 *
 * Deliberately ES5 and total: a syntax error or a thrown storage access leaves
 * the rail expanded, which is the recoverable failure.
 */
export const SIDEBAR_PREFERENCES_BOOTSTRAP_SCRIPT =
  `(function(){try{` +
  `var s=localStorage.getItem(${JSON.stringify(SIDEBAR_UI_PREFERENCE_KEY)});` +
  `if(!s){return;}` +
  `var p=JSON.parse(s);` +
  `if(!p||p.v!==${SIDEBAR_PREFERENCES_VERSION}){return;}` +
  `if(p.collapsed===true){document.documentElement.setAttribute(` +
  `${JSON.stringify(SIDEBAR_COLLAPSED_ATTRIBUTE)},'collapsed');}` +
  `}catch(e){}})();`;

/** Keep the CSS signal truthful after a toggle, so both agree at every frame. */
export function applySidebarCollapsedAttribute(collapsed: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (collapsed) {
    document.documentElement.setAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE, 'collapsed');
    return;
  }
  document.documentElement.removeAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE);
}
