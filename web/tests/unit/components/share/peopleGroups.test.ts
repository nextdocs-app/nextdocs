import type { Collaborator } from '@/services/document.service';
import { getPeopleGroups, getPersonDetail } from '@/components/share/peopleGroups';

function person(overrides: Partial<Collaborator> & Pick<Collaborator, 'userId'>): Collaborator {
  return {
    email: `${overrides.userId}@example.com`,
    displayName: overrides.userId,
    accessLevel: 'VIEW',
    addedAt: '2026-01-01T00:00:00Z',
    owner: false,
    ...overrides,
  };
}

describe('getPeopleGroups', () => {
  it('pins the viewer above the list, falling back to the owner', () => {
    const owner = person({ userId: 'alice', owner: true, accessLevel: 'OWNER' });
    const viewer = person({ userId: 'santhosh' });
    const direct = person({ userId: 'bob' });

    const grouped = getPeopleGroups([owner, viewer, direct], {
      pinnedUserId: 'santhosh',
    });

    expect(grouped.pinned).toBe(viewer);
    expect(grouped.flat.map((collab) => collab.userId)).toEqual(['alice', 'bob']);
    expect(grouped.groups).toEqual([]);

    const fallback = getPeopleGroups([owner, direct], { pinnedUserId: 'missing' });
    expect(fallback.pinned).toBe(owner);
  });

  it('keeps single-person sources flat and groups sources with multiple people', () => {
    const direct = person({ userId: 'bob' });
    const page = person({
      userId: 'carol',
      inherited: true,
      inheritedFromId: 'doc-parent',
      inheritedFromTitle: 'Product docs',
    });
    const space = person({
      userId: 'grace',
      inherited: true,
      inheritedFromId: 'space-1',
      inheritedFromTitle: 'Engineering',
    });

    const secondPagePerson = person({
      userId: 'dan',
      inherited: true,
      inheritedFromId: 'doc-parent',
      inheritedFromTitle: 'Product docs',
    });
    const grouped = getPeopleGroups([direct, page, secondPagePerson, space], {
      spaceId: 'space-1',
    });

    expect(grouped.pinned).toBeNull();
    expect(grouped.flat.map((collab) => collab.userId)).toEqual(['bob', 'grace']);
    expect(grouped.groups.map((group) => [group.kind, group.title, group.people.length])).toEqual([
      ['document', 'From “Product docs”', 2],
    ]);
    expect(getPersonDetail(page)).toBeNull();
    expect(getPersonDetail(space, { showSource: true })).toBe('From “Engineering”');
  });

  it('creates a collapsible group for each inherited source', () => {
    const grouped = getPeopleGroups(
      [
        person({
          userId: 'a',
          inherited: true,
          inheritedFromId: 'doc-product',
          inheritedFromTitle: 'Product docs',
        }),
        person({
          userId: 'b',
          inherited: true,
          inheritedFromId: 'doc-product',
          inheritedFromTitle: 'Product docs',
        }),
        person({
          userId: 'c',
          inherited: true,
          inheritedFromId: 'doc-wiki',
          inheritedFromTitle: 'Company wiki',
        }),
        person({
          userId: 'd',
          inherited: true,
          inheritedFromId: 'space-1',
          inheritedFromTitle: 'Engineering',
        }),
        person({
          userId: 'e',
          inherited: true,
          inheritedFromId: 'space-1',
          inheritedFromTitle: 'Engineering',
        }),
        person({ userId: 'f' }),
      ],
      { spaceId: 'space-1' }
    );

    expect(grouped.groups.map((group) => [group.kind, group.title, group.people.length])).toEqual([
      ['document', 'From “Product docs”', 2],
      ['space', 'From “Engineering”', 2],
    ]);
    expect(grouped.flat.map((collab) => collab.userId)).toEqual(['c', 'f']);
  });

  it('populates group icons when resolveIcon is provided', () => {
    const docIcon = { type: 'emoji' as const, value: '🚀' };
    const spaceIcon = { type: 'builtin' as const, value: 'folder', color: 'blue' as const };

    const grouped = getPeopleGroups(
      [
        person({
          userId: 'a',
          inherited: true,
          inheritedFromId: 'doc-product',
          inheritedFromTitle: 'Product docs',
        }),
        person({
          userId: 'b',
          inherited: true,
          inheritedFromId: 'doc-product',
          inheritedFromTitle: 'Product docs',
        }),
        person({
          userId: 'c',
          inherited: true,
          inheritedFromId: 'space-1',
          inheritedFromTitle: 'Engineering',
        }),
        person({
          userId: 'd',
          inherited: true,
          inheritedFromId: 'space-1',
          inheritedFromTitle: 'Engineering',
        }),
      ],
      {
        spaceId: 'space-1',
        resolveIcon: (id, kind) => {
          if (kind === 'document' && id === 'doc-product') return docIcon;
          if (kind === 'space' && id === 'space-1') return spaceIcon;
          return null;
        },
      }
    );

    expect(grouped.groups[0].icon).toEqual(docIcon);
    expect(grouped.groups[1].icon).toEqual(spaceIcon);
  });

  it('groups an inherited collaborator even when the pinned viewer shares the source', () => {
    const viewer = person({
      userId: 'me',
      inherited: true,
      inheritedFromId: 'space-1',
      inheritedFromTitle: 'Engineering',
    });
    const bob = person({
      userId: 'bob',
      inherited: true,
      inheritedFromId: 'space-1',
      inheritedFromTitle: 'Engineering',
    });

    const grouped = getPeopleGroups([viewer, bob], {
      spaceId: 'space-1',
      pinnedUserId: 'me',
    });

    expect(grouped.pinned).toBe(viewer);
    expect(grouped.groups).toEqual([]);
    expect(grouped.flat).toEqual([bob]);
    expect(getPersonDetail(bob, { showSource: true })).toBe('From “Engineering”');
  });

  it('keeps blocked people out of the flat list and in their own group', () => {
    const owner = person({ userId: 'alice', owner: true, accessLevel: 'OWNER' });
    const direct = person({ userId: 'bob' });
    const blocked = person({
      userId: 'eve',
      accessLevel: 'NO_ACCESS',
      inheritedFromTitle: 'Engineering',
      inheritedAccessLevel: 'VIEW',
    });

    const grouped = getPeopleGroups([owner, direct, blocked]);

    expect(grouped.pinned).toBe(owner);
    expect(grouped.flat.map((collab) => collab.userId)).toEqual(['bob']);
    expect(grouped.groups.map((group) => [group.kind, group.title, group.people.length])).toEqual([
      ['blocked', 'Blocked', 1],
    ]);
    expect(getPersonDetail(blocked)).toBe('Blocks “Engineering”');
  });
});

describe('getPersonDetail', () => {
  it('mentions only session-added direct grants as new', () => {
    const direct = person({ userId: 'bob' });

    expect(getPersonDetail(direct)).toBeNull();
    expect(getPersonDetail(direct, { recentlyAddedUserIds: new Set(['bob']) })).toBe(
      'Added just now'
    );
  });

  it('shows an override note', () => {
    const override = person({
      userId: 'bob',
      inheritedFromId: 'doc-parent',
      inheritedFromTitle: 'Product docs',
      inheritedAccessLevel: 'EDIT',
    });

    expect(getPersonDetail(override, { recentlyAddedUserIds: new Set(['bob']) })).toBe(
      'Overrides “Product docs”'
    );
  });

  it('leaves inherited rows and the owner without a detail badge', () => {
    const inherited = person({
      userId: 'carol',
      inherited: true,
      inheritedFromId: 'space-1',
      inheritedFromTitle: 'Engineering',
    });
    const owner = person({ userId: 'alice', owner: true, accessLevel: 'OWNER' });

    expect(getPersonDetail(inherited)).toBeNull();
    expect(getPersonDetail(owner)).toBeNull();
  });
});
