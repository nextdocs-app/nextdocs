/**
 * Parent links for documents that exist on this device before (or without) a
 * cloud row. IndexedDB stores the document body and metadata but no hierarchy,
 * so an offline reload would otherwise render every local document as a root.
 *
 * Only ids and parents are kept; anything missing is treated as a root. The
 * map lives under the `nextdocs:` prefix so the logout cleanup removes it with
 * the rest of the signed-in user's local state.
 */
const STORAGE_KEY = 'nextdocs:local-document-parents';

type ParentMap = Record<string, string | null>;

function readParentMap(): ParentMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const map: ParentMap = {};
    for (const [id, parentId] of Object.entries(parsed)) {
      if (parentId === null || typeof parentId === 'string') {
        map[id] = parentId;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writeParentMap(map: ParentMap): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
  } catch (error) {
    // The document is still safe in IndexedDB; a lost parent link only costs
    // the tree its nesting until the next successful write.
    console.warn('Failed to persist local document parents:', error);
  }
}

export function setLocalDocumentParents(
  links: readonly { id: string; parentId: string | null }[]
): void {
  if (links.length === 0) {
    return;
  }

  const map = readParentMap();
  let changed = false;

  for (const link of links) {
    if (map[link.id] !== link.parentId) {
      map[link.id] = link.parentId;
      changed = true;
    }
  }

  // A periodic tree sync usually repeats the same hierarchy; avoid rewriting
  // storage when nothing moved.
  if (changed) {
    writeParentMap(map);
  }
}

export function setLocalDocumentParent(id: string, parentId: string | null): void {
  setLocalDocumentParents([{ id, parentId }]);
}

export function clearLocalDocumentParent(id: string): void {
  const map = readParentMap();
  if (Object.prototype.hasOwnProperty.call(map, id)) {
    delete map[id];
    writeParentMap(map);
  }
}

export function getLocalDocumentParents(): ReadonlyMap<string, string | null> {
  return new Map(Object.entries(readParentMap()));
}
