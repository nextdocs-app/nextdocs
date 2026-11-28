/**
 * One relative-time formatter for the whole app. Callers decide the prefix
 * ("Edited ", "Last viewed ") — the distance is spoken the same way everywhere.
 */

export type RelativeTimeStyle = 'long' | 'compact';

export interface RelativeTimeOptions {
  /** `long` spells the unit out; `compact` is the dense "5m ago" search style. */
  style?: RelativeTimeStyle;
  /** How many days stay relative before falling back to a calendar date. */
  maxRelativeDays?: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function formatRelativeTime(
  value: string | null | undefined,
  { style = 'long', maxRelativeDays = 7 }: RelativeTimeOptions = {}
): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const now = Date.now();
  // A clock that runs behind the server must not report "in -3 mins".
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / MS_PER_MINUTE);
  const hours = Math.floor(elapsed / MS_PER_HOUR);
  const days = Math.floor(elapsed / MS_PER_DAY);

  if (style === 'compact') {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < maxRelativeDays) return `${days}d ago`;
    return formatCalendarDate(timestamp, now);
  }

  const seconds = Math.round(elapsed / 1000);
  if (seconds < 30) return 'just now';
  if (minutes < 1) return 'seconds ago';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} mins ago`;
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  if (days < maxRelativeDays) return `${days} days ago`;
  return formatCalendarDate(timestamp, now);
}

function formatCalendarDate(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
}
