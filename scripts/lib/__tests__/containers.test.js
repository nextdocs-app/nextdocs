'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { flushPrefixInSteps, postgresBindingProblem, redisFlushPrefix } = require('../containers');

test('prefix cleanup takes one bounded scan step per Redis call', () => {
  const cursors = ['17', '42', '0'];
  const seen = [];
  let otherWorktreeCommands = 0;

  const removed = flushPrefixInSteps('yhub_a:*', (cursor) => {
    seen.push(cursor);
    // Between two of our calls another worktree can use Redis: the scan loop lives in
    // this client, not inside one atomic Lua script.
    otherWorktreeCommands += 1;
    return { cursor: cursors.shift(), removed: 2 };
  });

  assert.deepEqual(seen, ['0', '17', '42']);
  assert.equal(removed, 6);
  assert.equal(otherWorktreeCommands, 3);
});

test('prefix cleanup stops with an error instead of looping on a stuck cursor', () => {
  assert.throws(
    () => flushPrefixInSteps('yhub_a:*', () => ({ cursor: '9', removed: 0 }), { maxSteps: 5 }),
    /Gave up clearing/
  );
});

test('an empty Redis prefix is rejected before any container call', () => {
  // `prefixOverride || redisPrefix()` used to fall back to the *invoking* worktree when
  // a record carried an empty prefix; prune could then delete another worktree's keys.
  assert.throws(() => redisFlushPrefix(''), /unexpected Redis prefix/);
  assert.throws(() => redisFlushPrefix('yhub*'), /unexpected Redis prefix/);
});

test('the Postgres mapping must be loopback on the documented host port', () => {
  const mapping = (HostIp, HostPort = '5433') => ({ '5432/tcp': [{ HostIp, HostPort }] });

  // The mapping ./nd dev creates: reachable on loopback, on the port everything targets.
  assert.equal(postgresBindingProblem(mapping('127.0.0.1')), null);
  assert.equal(postgresBindingProblem(mapping('::1')), null);

  // An old container on another host port passes provisioning inside the container while
  // the API and Flyway connect to 5433, so it has to be rejected.
  assert.match(postgresBindingProblem(mapping('127.0.0.1', '5544')), /expects 127\.0\.0\.1:5433/);

  // Published beyond loopback, and unpublished, are both refused.
  assert.match(postgresBindingProblem(mapping('0.0.0.0')), /not bound to loopback only/);
  assert.match(postgresBindingProblem(mapping('')), /not bound to loopback only/);
  assert.match(postgresBindingProblem({}), /publishes no host port/);
  assert.match(postgresBindingProblem(null), /publishes no host port/);
});
