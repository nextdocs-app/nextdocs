import { compareSpacesByPersonalOrder, insertSpaceByPersonalOrder } from '@/lib/space-order.util';
import type { Space } from '@/types/space.types';

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: 'space-1',
    name: 'Team',
    icon: null,
    accessMode: 'CUSTOM',
    everyoneAccessLevel: 'VIEW',
    myAccessLevel: 'OWNER',
    canAdminister: true,
    memberCount: 1,
    pageCount: 0,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('compareSpacesByPersonalOrder', () => {
  it('orders positioned spaces by key before unpositioned ones', () => {
    const positioned = makeSpace({ id: 'positioned', orderKey: 'a5' });
    const unpositioned = makeSpace({ id: 'unpositioned', createdAt: '2025-01-01T00:00:00Z' });

    expect(compareSpacesByPersonalOrder(positioned, unpositioned)).toBe(-1);
    expect(compareSpacesByPersonalOrder(unpositioned, positioned)).toBe(1);
  });

  it('compares positioned spaces by their fractional key', () => {
    const first = makeSpace({ id: 'first', orderKey: 'a0' });
    const second = makeSpace({ id: 'second', orderKey: 'a1' });

    expect(compareSpacesByPersonalOrder(first, second)).toBe(-1);
    expect(compareSpacesByPersonalOrder(second, first)).toBe(1);
  });

  it('falls back to creation time, then id, when neither space is positioned', () => {
    const older = makeSpace({ id: 'b', createdAt: '2026-01-01T00:00:00Z' });
    const newer = makeSpace({ id: 'a', createdAt: '2026-02-01T00:00:00Z' });

    expect(compareSpacesByPersonalOrder(older, newer)).toBe(-1);
    expect(compareSpacesByPersonalOrder(newer, older)).toBe(1);

    const sameTimeA = makeSpace({ id: 'a' });
    const sameTimeB = makeSpace({ id: 'b' });
    expect(compareSpacesByPersonalOrder(sameTimeA, sameTimeB)).toBe(-1);
  });
});

describe('insertSpaceByPersonalOrder', () => {
  it('places a newly created space first when its key precedes every other', () => {
    const existing = [
      makeSpace({ id: 'design', orderKey: 'a1' }),
      makeSpace({ id: 'ops', orderKey: 'a2' }),
    ];
    const created = makeSpace({ id: 'research', orderKey: 'a0' });

    expect(insertSpaceByPersonalOrder(existing, created).map((space) => space.id)).toEqual([
      'research',
      'design',
      'ops',
    ]);
  });

  it('replaces an existing row instead of duplicating it', () => {
    const existing = [
      makeSpace({ id: 'design', orderKey: 'a1' }),
      makeSpace({ id: 'ops', orderKey: 'a2' }),
    ];
    const renamed = { ...existing[0], name: 'Design system' };

    const result = insertSpaceByPersonalOrder(existing, renamed);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Design system');
  });
});
