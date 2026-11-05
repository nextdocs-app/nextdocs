import type { Collaborator } from '@/services/document.service';
import type { DocumentIcon } from '@/types/document.types';
import { normalizeTitle } from './shareOptions';

export type PeopleGroupKind = 'document' | 'space' | 'blocked';

export interface PeopleGroup {
  key: string;
  kind: PeopleGroupKind;
  /** `From “Product docs”`, or `Blocked`. */
  title: string;
  sourceId: string | null;
  sourceTitle: string | null;
  icon?: DocumentIcon | null;
  people: Collaborator[];
}

export interface PeopleGrouping {
  /** The viewer, pinned above the list. Falls back to the owner for readers. */
  pinned: Collaborator | null;
  /** Direct people and single-person sources, rendered as ordinary rows. */
  flat: Collaborator[];
  /** Sources with two or more people, plus Blocked. */
  groups: PeopleGroup[];
}

const GROUP_ORDER: Record<PeopleGroupKind, number> = {
  document: 0,
  space: 1,
  blocked: 2,
};

export function isSpaceSource(collab: Collaborator, spaceId?: string | null): boolean {
  return Boolean(spaceId && collab.inheritedFromId === spaceId);
}

/**
 * Notion's shape: pin the viewer, then show people as one flat list. A source
 * earns a collapsible row only when more than one other person comes from it;
 * a one-person source is just a row with a `From “…”` note. Direct grants are
 * never a group — the row's `Overrides` / `Added just now` note says what is
 * special about it.
 */
export function getPeopleGroups(
  collaborators: Collaborator[],
  options: {
    spaceId?: string | null;
    pinnedUserId?: string | null;
    resolveIcon?: (
      sourceId: string | null,
      kind: PeopleGroupKind
    ) => DocumentIcon | null | undefined;
  } = {}
): PeopleGrouping {
  const { spaceId = null, pinnedUserId = null, resolveIcon } = options;
  const pinned =
    (pinnedUserId
      ? collaborators.find(
          (collab) => collab.userId === pinnedUserId && collab.accessLevel !== 'NO_ACCESS'
        )
      : undefined) ??
    collaborators.find((collab) => collab.owner) ??
    null;

  const buckets = new Map<
    string,
    {
      key: string;
      kind: 'document' | 'space';
      title: string;
      sourceId: string | null;
      people: Collaborator[];
    }
  >();
  const blocked: Collaborator[] = [];

  for (const collab of collaborators) {
    if (collab === pinned) continue;

    if (collab.accessLevel === 'NO_ACCESS') {
      blocked.push(collab);
      continue;
    }

    if (!collab.inherited) {
      continue;
    }

    const isSpace = isSpaceSource(collab, spaceId);
    const sourceTitle = normalizeTitle(
      collab.inheritedFromTitle,
      isSpace ? 'Untitled space' : 'Untitled'
    );
    const key = `${isSpace ? 'space' : 'document'}:${collab.inheritedFromId ?? sourceTitle}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.people.push(collab);
    } else {
      buckets.set(key, {
        key,
        kind: isSpace ? 'space' : 'document',
        title: sourceTitle,
        sourceId: collab.inheritedFromId ?? null,
        people: [collab],
      });
    }
  }

  const groupedUserIds = new Set<string>();
  for (const bucket of buckets.values()) {
    if (bucket.people.length >= 2) {
      for (const person of bucket.people) groupedUserIds.add(person.userId);
    }
  }
  const flat = collaborators.filter((collab) => {
    if (collab === pinned || collab.accessLevel === 'NO_ACCESS') return false;
    return !collab.inherited || !groupedUserIds.has(collab.userId);
  });

  const groups: PeopleGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.people.length < 2) continue;
    groups.push({
      key: bucket.key,
      kind: bucket.kind,
      title: `From “${bucket.title}”`,
      sourceId: bucket.sourceId,
      sourceTitle: bucket.title,
      icon: resolveIcon ? (resolveIcon(bucket.sourceId, bucket.kind) ?? null) : undefined,
      people: bucket.people,
    });
  }
  groups.sort((a, b) => GROUP_ORDER[a.kind] - GROUP_ORDER[b.kind]);

  if (blocked.length > 0) {
    groups.push({
      key: 'blocked',
      kind: 'blocked',
      title: 'Blocked',
      sourceId: null,
      sourceTitle: null,
      icon: null,
      people: blocked,
    });
  }

  return { pinned, flat, groups };
}

/**
 * One metadata line, only when the row has something to explain. A flat row
 * from a single-person source says where it came from; a grouped row does not
 * (its header already says it). Direct rows say what changed.
 */
export function getPersonDetail(
  collab: Collaborator,
  options: {
    recentlyAddedUserIds?: ReadonlySet<string>;
    showSource?: boolean;
  } = {}
): string | null {
  const { recentlyAddedUserIds = new Set<string>() } = options;

  if (collab.owner) return null;

  const source = normalizeTitle(collab.inheritedFromTitle, '');

  if (collab.accessLevel === 'NO_ACCESS') {
    if (!source) return 'No access on this page';
    return `Blocks “${source}”`;
  }

  if (collab.inherited) {
    return options.showSource && source ? `From “${source}”` : null;
  }

  if (source) return `Overrides “${source}”`;
  if (recentlyAddedUserIds.has(collab.userId)) return 'Added just now';
  return null;
}
