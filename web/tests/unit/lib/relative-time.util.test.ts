import { formatRelativeTime } from '../../../lib/relative-time.util';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function at(millisecondsAgo: number): string {
  return new Date(NOW.getTime() - millisecondsAgo).toISOString();
}

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function calendarDate(iso: string, now = NOW): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

describe('formatRelativeTime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null for missing and unparseable timestamps', () => {
    expect(formatRelativeTime(null)).toBeNull();
    expect(formatRelativeTime(undefined)).toBeNull();
    expect(formatRelativeTime('')).toBeNull();
    expect(formatRelativeTime('not-a-date')).toBeNull();
  });

  it('never speaks a future timestamp as negative time', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5 * minute).toISOString())).toBe('just now');
    expect(
      formatRelativeTime(new Date(NOW.getTime() + 5 * minute).toISOString(), { style: 'compact' })
    ).toBe('just now');
  });

  describe('long style', () => {
    it('stays "just now" for less than half a minute', () => {
      expect(formatRelativeTime(at(5_000))).toBe('just now');
    });

    it('uses seconds under a minute', () => {
      expect(formatRelativeTime(at(45_000))).toBe('seconds ago');
    });

    it('singularises the first minute, hour and day', () => {
      expect(formatRelativeTime(at(minute + 1_000))).toBe('1 min ago');
      expect(formatRelativeTime(at(hour + 1_000))).toBe('1 hour ago');
      expect(formatRelativeTime(at(day + 1_000))).toBe('yesterday');
    });

    it('pluralises minutes, hours and days', () => {
      expect(formatRelativeTime(at(5 * minute))).toBe('5 mins ago');
      expect(formatRelativeTime(at(3 * hour))).toBe('3 hours ago');
      expect(formatRelativeTime(at(3 * day))).toBe('3 days ago');
    });

    it('falls back to a calendar date after the relative window', () => {
      const iso = at(7 * day);
      expect(formatRelativeTime(iso)).toBe(calendarDate(iso));
    });

    it('honours a shorter maxRelativeDays window', () => {
      const iso = at(2 * day);
      expect(formatRelativeTime(iso, { maxRelativeDays: 1 })).toBe(calendarDate(iso));
      expect(formatRelativeTime(iso, { maxRelativeDays: 3 })).toBe('2 days ago');
    });

    it('adds the year for a date from another year', () => {
      const iso = '2024-02-03T10:00:00.000Z';
      expect(formatRelativeTime(iso)).toBe(calendarDate(iso));
      expect(formatRelativeTime(iso)).toContain('2024');
    });
  });

  describe('compact style', () => {
    const compact = (value: string) => formatRelativeTime(value, { style: 'compact' });

    it('compresses the first hours into single units', () => {
      expect(compact(at(10_000))).toBe('just now');
      expect(compact(at(5 * minute))).toBe('5m ago');
      expect(compact(at(3 * hour))).toBe('3h ago');
    });

    it('keeps one day and under a week relative', () => {
      expect(compact(at(day + 1_000))).toBe('yesterday');
      expect(compact(at(3 * day))).toBe('3d ago');
      expect(compact(at(6 * day))).toBe('6d ago');
    });

    it('falls back to a calendar date a week out', () => {
      const iso = at(7 * day);
      expect(compact(iso)).toBe(calendarDate(iso));
    });

    it('honors a custom maxRelativeDays cutoff while keeping yesterday', () => {
      expect(formatRelativeTime(at(day + 1_000), { style: 'compact', maxRelativeDays: 3 })).toBe(
        'yesterday'
      );
      expect(formatRelativeTime(at(2 * day), { style: 'compact', maxRelativeDays: 3 })).toBe(
        '2d ago'
      );
      const cutoffIso = at(3 * day);
      expect(formatRelativeTime(cutoffIso, { style: 'compact', maxRelativeDays: 3 })).toBe(
        calendarDate(cutoffIso)
      );
    });
  });
});
