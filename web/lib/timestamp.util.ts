export function toSortableTimestamp(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
