import type { Space } from '@/types/space.types';

/**
 * Mirrors the API's space listing order: the caller's positioned spaces first
 * in key order, then unpositioned ones oldest first, with the id as the final
 * tie-break. Used where the web inserts a space locally and has to place it
 * without a round-trip.
 */
export function compareSpacesByPersonalOrder(first: Space, second: Space): number {
  const firstKey = first.orderKey ?? null;
  const secondKey = second.orderKey ?? null;

  if ((firstKey === null) !== (secondKey === null)) {
    return firstKey === null ? 1 : -1;
  }

  if (firstKey !== null && secondKey !== null && firstKey !== secondKey) {
    return firstKey < secondKey ? -1 : 1;
  }

  const byCreatedAt = first.createdAt.localeCompare(second.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : first.id.localeCompare(second.id);
}

/**
 * Places a space the caller just created or restored where the API would list
 * it, without waiting for a refetch. A space that is already present is moved
 * to its ordered slot instead of being duplicated.
 */
export function insertSpaceByPersonalOrder(spaces: Space[], space: Space): Space[] {
  const without = spaces.filter((item) => item.id !== space.id);
  const index = without.findIndex((item) => compareSpacesByPersonalOrder(space, item) < 0);
  return index < 0
    ? [...without, space]
    : [...without.slice(0, index), space, ...without.slice(index)];
}
