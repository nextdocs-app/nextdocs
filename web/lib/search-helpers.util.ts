import { sanitizeDocumentIcon } from '@/lib/document-icon.util';
import { toSortableTimestamp } from '@/lib/timestamp.util';
import type { LocalDocumentEntry } from '@/stores/documentList/documentList.types';
import type { SpaceSummary, SpaceTree } from '@/stores/spaceTree/spaceTree.slice';
import type {
  SearchBreadcrumb,
  SearchHit,
  SearchSpace,
  SearchTextSegment,
} from '@/types/search.types';
import type { SidebarTreeNode } from '@/types/tree.types';

const RECENT_STORAGE_PREFIX = 'nextdocs:recent-docs:';
const MAX_RECENT_DOCUMENT_IDS = 15;

function recentStorageKey(userId: string | null | undefined): string {
  return `${RECENT_STORAGE_PREFIX}${userId || 'guest'}`;
}

export function getRecentDocumentIds(userId: string | null | undefined): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(recentStorageKey(userId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function recordRecentDocumentVisit(
  userId: string | null | undefined,
  documentId: string
): void {
  if (typeof window === 'undefined' || !documentId) {
    return;
  }
  try {
    const current = getRecentDocumentIds(userId).filter((id) => id !== documentId);
    const next = [documentId, ...current].slice(0, MAX_RECENT_DOCUMENT_IDS);
    window.localStorage.setItem(recentStorageKey(userId), JSON.stringify(next));
  } catch {
    // Ignore storage quota or privacy-mode errors.
  }
}

/**
 * True when a Mod+K press belongs to the editor's create-link shortcut instead
 * of the app-wide search shortcut. BlockNote advertises Mod+K on its link
 * button, and the link action only makes sense over a selection, so the window
 * listener must not siphon the keystroke while text is selected.
 */
export function isEditorLinkShortcutTarget(target: EventTarget | null): boolean {
  if (typeof window === 'undefined' || !(target instanceof Element)) {
    return false;
  }
  const editable = target.closest('[contenteditable="true"], .bn-editor, .ProseMirror');
  if (!editable) {
    return false;
  }
  const selection = window.getSelection();
  return selection !== null && selection.isCollapsed === false;
}

/**
 * Splits `text` into plain and matched segments for case-insensitive substring
 * matches. Used for offline fallback hits and their breadcrumb paths.
 */
export function buildMatchSegments(text: string, query: string): SearchTextSegment[] {
  if (!text) {
    return [];
  }
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [{ text, match: false }];
  }

  const haystack = text.toLowerCase();
  const segments: SearchTextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = haystack.indexOf(needle, cursor);
    if (matchIndex < 0) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (matchIndex > cursor) {
      segments.push({ text: text.slice(cursor, matchIndex), match: false });
    }
    segments.push({
      text: text.slice(matchIndex, matchIndex + needle.length),
      match: true,
    });
    cursor = matchIndex + needle.length;
  }

  return segments;
}

/** Formats an ISO timestamp as a compact "Edited 2m ago" label for a result row. */
export function formatRelativeSearchTime(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) {
    return 'Edited just now';
  }
  if (diffMinutes < 60) {
    return `Edited ${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Edited ${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return 'Edited yesterday';
  }
  if (diffDays < 7) {
    return `Edited ${diffDays}d ago`;
  }

  const date = new Date(timestamp);
  const currentYear = new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== currentYear ? { year: 'numeric' } : {}),
  });
  return `Edited ${day}`;
}

interface CandidateDocument {
  id: string;
  title: string;
  parentId: string | null;
  icon: SearchHit['icon'];
  updatedAt: string | null;
  space: SearchSpace | null;
}

function resolveTreeBreadcrumbs(
  parentId: string | null,
  nodeMaps: Record<string, SidebarTreeNode>[]
): SearchBreadcrumb[] {
  const chain: SearchBreadcrumb[] = [];
  const visited = new Set<string>();
  let currentId = parentId;

  while (currentId && !visited.has(currentId) && chain.length < 16) {
    visited.add(currentId);
    let node: SidebarTreeNode | undefined;
    for (const map of nodeMaps) {
      if (map[currentId]) {
        node = map[currentId];
        break;
      }
    }
    if (!node) {
      break;
    }
    chain.unshift({ id: node.id, title: node.title || 'Untitled' });
    currentId = node.parentId;
  }

  return chain;
}

export interface BuildLocalSearchHitsInput {
  documents: LocalDocumentEntry[];
  sharedDocuments?: LocalDocumentEntry[];
  trashedDocuments?: LocalDocumentEntry[];
  sidebarNodes?: Record<string, SidebarTreeNode>;
  sharedNodes?: Record<string, SidebarTreeNode>;
  spaceTrees?: Record<string, SpaceTree>;
  spaces?: Record<string, SpaceSummary>;
  recentIds?: string[];
  query: string;
  limit?: number;
}

/**
 * Builds `SearchHit` entries from documents already cached in Redux (for the
 * initial "Recent documents" view, guest browsing, and offline title fallback).
 */
export function buildLocalSearchHits({
  documents,
  sharedDocuments = [],
  trashedDocuments = [],
  sidebarNodes = {},
  sharedNodes = {},
  spaceTrees = {},
  spaces = {},
  recentIds = [],
  query,
  limit = 10,
}: BuildLocalSearchHitsInput): SearchHit[] {
  const trashedIds = new Set([
    ...trashedDocuments.map((doc) => doc.id),
    // A cached listing can predate the trash refresh: its own metadata already says the
    // document is gone, so it must not surface as an active result.
    ...documents.filter((doc) => Boolean(doc.meta.deletedAt)).map((doc) => doc.id),
    ...sharedDocuments.filter((doc) => Boolean(doc.meta.deletedAt)).map((doc) => doc.id),
  ]);
  const candidates = new Map<string, CandidateDocument>();

  const upsert = (entry: CandidateDocument) => {
    if (!entry.id || trashedIds.has(entry.id)) {
      return;
    }
    const existing = candidates.get(entry.id);
    if (!existing) {
      candidates.set(entry.id, entry);
      return;
    }
    // Whichever entry is newer owns the title: sources are merged in arrival order, so a
    // stale sidebar copy must not rename a row a fresh listing just updated.
    const entryIsNewer =
      toSortableTimestamp(entry.updatedAt) >= toSortableTimestamp(existing.updatedAt);
    candidates.set(entry.id, {
      id: entry.id,
      title: entryIsNewer ? entry.title || existing.title : existing.title || entry.title,
      parentId: entry.parentId ?? existing.parentId,
      // Recency, not presence: a newer entry with no icon means the icon was removed.
      icon: entryIsNewer ? entry.icon : existing.icon,
      updatedAt: entryIsNewer ? (entry.updatedAt ?? existing.updatedAt) : existing.updatedAt,
      space: entry.space ?? existing.space,
    });
  };

  for (const doc of documents) {
    upsert({
      id: doc.id,
      title: doc.meta.title || 'Untitled',
      parentId: doc.parentId ?? null,
      icon: sanitizeDocumentIcon(doc.meta.icon) ?? null,
      updatedAt: doc.meta.updatedAt ?? null,
      space: null,
    });
  }

  for (const doc of sharedDocuments) {
    upsert({
      id: doc.id,
      title: doc.meta.title || 'Untitled',
      parentId: doc.parentId ?? null,
      icon: sanitizeDocumentIcon(doc.meta.icon) ?? null,
      updatedAt: doc.meta.updatedAt ?? null,
      space: null,
    });
  }

  for (const node of Object.values(sidebarNodes)) {
    upsert({
      id: node.id,
      title: node.title || 'Untitled',
      parentId: node.parentId ?? null,
      icon: sanitizeDocumentIcon(node.icon) ?? null,
      updatedAt: node.updatedAt ?? null,
      space: null,
    });
  }

  for (const node of Object.values(sharedNodes)) {
    upsert({
      id: node.id,
      title: node.title || 'Untitled',
      parentId: node.parentId ?? null,
      icon: sanitizeDocumentIcon(node.icon) ?? null,
      updatedAt: node.updatedAt ?? null,
      space: null,
    });
  }

  const spaceNodeMaps: Record<string, SidebarTreeNode>[] = [];
  for (const [spaceId, tree] of Object.entries(spaceTrees)) {
    spaceNodeMaps.push(tree.nodes);
    const spaceMeta = spaces[spaceId];
    const spaceSummary: SearchSpace | null = spaceMeta
      ? { id: spaceMeta.id, name: spaceMeta.name }
      : null;
    for (const node of Object.values(tree.nodes)) {
      upsert({
        id: node.id,
        title: node.title || 'Untitled',
        parentId: node.parentId ?? null,
        icon: sanitizeDocumentIcon(node.icon) ?? null,
        updatedAt: node.updatedAt ?? null,
        space: spaceSummary,
      });
    }
  }

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const recentOrder = new Map(recentIds.map((id, index) => [id, index]));

  const filtered = Array.from(candidates.values()).filter((doc) => {
    if (!needle) {
      return true;
    }
    return doc.title.toLowerCase().includes(needle);
  });

  filtered.sort((a, b) => {
    if (needle) {
      const aStarts = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
      const bStarts = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }
    } else {
      const aRecent = recentOrder.get(a.id);
      const bRecent = recentOrder.get(b.id);
      if (aRecent !== undefined && bRecent !== undefined) {
        return aRecent - bRecent;
      }
      if (aRecent !== undefined) return -1;
      if (bRecent !== undefined) return 1;
    }

    return toSortableTimestamp(b.updatedAt) - toSortableTimestamp(a.updatedAt);
  });

  const nodeMaps = [sidebarNodes, sharedNodes, ...spaceNodeMaps];

  return filtered.slice(0, limit).map((doc) => ({
    documentId: doc.id,
    title: needle ? buildMatchSegments(doc.title, trimmed) : [{ text: doc.title, match: false }],
    snippet: [],
    breadcrumb: resolveTreeBreadcrumbs(doc.parentId, nodeMaps),
    space: doc.space,
    icon: doc.icon,
    updatedAt: doc.updatedAt,
  }));
}
