'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { uuidv5, seedId } = require('../lib/ids');
const { parseArgs } = require('../lib/args');
const { buildPlan, assertReactionAuthorsDistinct } = require('../lib/plan');
const { compileMarkdown, getConverter, commentThreadIdsOf } = require('../lib/markdown');
const { createAnchorSelection } = require('../lib/anchors');
const { dateDaysAgo, afterOrEqual } = require('../lib/time');
const { commentMarkKey } = require('../lib/comment-mark');
const { Client } = require('../lib/http');

test('seed does not replay writes after an unknown transport outcome', async () => {
  const client = new Client({
    apiBaseUrl: 'http://localhost',
    realtimeBaseUrl: 'http://localhost',
  });
  let calls = 0;
  client.fetchRaw = async () => {
    calls += 1;
    throw new Error('connection lost');
  };
  await assert.rejects(client.request('POST', '/threads'), /connection lost/);
  assert.equal(calls, 1);
});

test('seed does not replay writes after a server error', async () => {
  const client = new Client({
    apiBaseUrl: 'http://localhost',
    realtimeBaseUrl: 'http://localhost',
  });
  let calls = 0;
  client.fetchRaw = async () => {
    calls += 1;
    return { status: 500, json: async () => null };
  };
  await assert.rejects(client.request('POST', '/threads'), /500/);
  assert.equal(calls, 1);
});

test('uuidv5 is deterministic, version 5 and RFC 4122 variant', () => {
  const first = seedId('doc', 'eng/on-call-runbook');
  const second = seedId('doc', 'eng/on-call-runbook');
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, seedId('doc', 'eng/local-development'));
  assert.equal(uuidv5('seed:v1:doc:eng/on-call-runbook'), first);
});

test('parseArgs defaults to the regular profile and rejects unknown input', () => {
  assert.equal(parseArgs([]).profile, 'regular');
  assert.equal(parseArgs(['small']).profile, 'small');
  assert.equal(parseArgs(['--yes', 'large']).profile, 'large');
  assert.equal(parseArgs(['--verify', '--verbose']).verify, true);
  assert.throws(() => parseArgs(['huge']), /Unknown seed profile/);
  assert.throws(() => parseArgs(['--nope']), /Unknown seed option/);
});

test('profiles produce the documented shape', () => {
  const small = buildPlan('small');
  assert.deepEqual(small.workspace.icon, {
    type: 'BUILTIN',
    value: 'office-building-tall-2',
    color: 'blue',
  });
  assert.equal(small.expectations.users, 6);
  assert.equal(small.expectations.spaces, 3);
  assert.equal(small.expectations.documents, 22);
  assert.equal(small.expectations.threads, 7);
  assert.equal(small.expectations.attachments, 2);

  const regular = buildPlan('regular');
  assert.equal(regular.expectations.users, 10);
  assert.equal(regular.expectations.spaces, 6);
  assert.equal(regular.expectations.documents, 38);
  assert.equal(regular.expectations.trashed, 1);
  assert.equal(regular.expectations.archivedSpaces, 1);

  const large = buildPlan('large');
  assert.equal(large.expectations.users, 20);
  assert.equal(large.expectations.documents, 158);
  assert.equal(large.expectations.threads, regular.expectations.threads);
});

test('every profile seeds two selectively shared private pages into Shared', () => {
  for (const profile of ['small', 'regular', 'large']) {
    const plan = buildPlan(profile);
    const shared = plan.documents.filter((doc) => doc.sharedPrivate);
    assert.equal(shared.length, 2, `${profile} shared private pages`);

    for (const doc of shared) {
      assert.ok(doc.sharing.length > 0, `${doc.key} has no recipients`);
      assert.ok(
        doc.sharing.length < plan.users.length - 1,
        `${doc.key} is shared with the whole workspace`
      );
      assert.ok(doc.icon, `${doc.key} needs an icon`);
      assert.ok(doc.sharing.every((share) => share.user !== doc.author));
    }

    for (const user of plan.users) {
      const covered = shared.some((doc) => doc.sharing.some((share) => share.user === user.key));
      assert.ok(covered, `${profile}/${user.key} is not a recipient of a shared page`);
    }
  }
});

test('markdown converts to expected BlockNote blocks and survives a round trip', async () => {
  const { editor } = await getConverter();
  const blocks = editor.tryParseMarkdownToBlocks(
    '# Heading\n\nA paragraph.\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'paragraph', 'bulletListItem', 'bulletListItem', 'table']
  );

  const compiled = await compileMarkdown('# Heading\n\nA paragraph.\n');
  assert.ok(compiled.base64.length > 0);
  assert.match(compiled.text, /Heading/);
  assert.match(compiled.text, /A paragraph\./);
});

test('a fixture quote resolves to relative positions and can carry a comment mark', async () => {
  const plan = buildPlan('small');
  const doc = plan.documents.find((candidate) => candidate.key === 'eng/on-call-runbook');
  const compiled = await compileMarkdown(doc.markdown);
  const { Y } = await getConverter();

  const selection = createAnchorSelection(compiled.doc, 'acknowledge within 15 minutes', 1, Y);
  assert.ok(selection.anchor && selection.head);

  const threadId = '11111111-1111-5111-8111-111111111111';
  const root = compiled.doc.get('blocknote');
  const paragraph = root
    .toArray()
    .flatMap((node) => (node.toArray ? node.toArray() : []))
    .flatMap((node) => (node.toArray ? node.toArray() : []))
    .find((node) => node && typeof node.toArray === 'function' && node.length > 100);
  assert.ok(paragraph, 'expected a paragraph node');
  const text = paragraph
    .toArray()
    .filter((child) => typeof child === 'string')
    .join('');
  const start = text.indexOf('acknowledge within 15 minutes');
  paragraph.format(start, 'acknowledge within 15 minutes'.length, {
    [commentMarkKey(threadId)]: { orphan: false, threadId },
  });

  assert.ok(commentThreadIdsOf(compiled.doc).has(threadId));
});

test('a missing quote fails instead of creating an unanchored comment', async () => {
  const plan = buildPlan('small');
  const doc = plan.documents.find((candidate) => candidate.key === 'eng/on-call-runbook');
  const compiled = await compileMarkdown(doc.markdown);
  const { Y } = await getConverter();
  assert.throws(
    () => createAnchorSelection(compiled.doc, 'this sentence is not in the page', 1, Y),
    /does not occur/
  );
});

test('reaction authors on one thread must stay distinct per emoji', () => {
  // The seed moves each reaction to its fixture author, and the table is unique on
  // (comment, user, emoji): a duplicate would abort the reassignment transaction.
  const thread = (reactions) => [{ key: 'eng/example', comments: [{ index: 0, reactions }] }];

  assert.throws(
    () =>
      assertReactionAuthorsDistinct(
        thread([
          { author: 'mei', emoji: '👍' },
          { author: 'mei', emoji: '👍' },
        ])
      ),
    /collide on \(comment, user, emoji\)/
  );
  assert.doesNotThrow(() =>
    assertReactionAuthorsDistinct(
      thread([
        { author: 'mei', emoji: '👍' },
        { author: 'jonas', emoji: '👍' },
      ])
    )
  );
});

test('timestamps are deterministic and updated_at never precedes created_at', () => {
  const first = dateDaysAgo(10, 'doc:example');
  const second = dateDaysAgo(10, 'doc:example');
  assert.equal(first.toISOString(), second.toISOString());

  const created = dateDaysAgo(20, 'doc:example');
  const updated = afterOrEqual(dateDaysAgo(30, 'doc:example'), created, 'doc:example');
  assert.ok(updated.getTime() > created.getTime());
});
