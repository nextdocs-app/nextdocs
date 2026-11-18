'use strict';

/**
 * Dates are relative to the run date and quantized to a fixed UTC hour so rows do not
 * all share one second. A stable hash of the fixture key keeps the offset deterministic
 * across runs and machines.
 */
function hashKey(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dateDaysAgo(daysAgo, key) {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  const hash = hashKey(key);
  date.setUTCHours(9 + (hash % 7), ((hash >> 3) % 6) * 10, hash % 60, 0);
  return date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

/** `updated_at` may not precede `created_at`; nudge it forward when a fixture is odd. */
function afterOrEqual(candidate, floor, key) {
  if (candidate.getTime() >= floor.getTime()) return candidate;
  return new Date(floor.getTime() + 3_600_000 + (hashKey(key) % 7200) * 1000);
}

function iso(date) {
  return date.toISOString();
}

module.exports = { hashKey, dateDaysAgo, addDays, afterOrEqual, iso };
