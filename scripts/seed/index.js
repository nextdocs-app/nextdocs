'use strict';

const fs = require('fs');
const path = require('path');
const { info, success, error } = require('../lib/proc');
const {
  apiBaseUrl,
  realtimeBaseUrl,
  getInstance,
  apiDatabase,
  yhubDatabase,
  attachmentStoragePath,
  assertLocalDatabase,
} = require('../lib/constants');
const { queryValue, tableExists } = require('../lib/containers');
const { migrationState } = require('../lib/flyway');
const { confirmDestructive } = require('../lib/prompt');
const { Client } = require('./lib/http');
const { parseArgs, USAGE } = require('./lib/args');
const { buildPlan } = require('./lib/plan');
const { getConverter, compileMarkdown } = require('./lib/markdown');
const { createAnchorSelection } = require('./lib/anchors');
const { backdate } = require('./lib/backdate');
const { runSql, sqlString, sqlDate, queryValueFrom, sha256Hex } = require('./lib/sql');
const { insertIdentity } = require('./sql/identity');
const { verifySeed } = require('./lib/verify');
const scenario = require('./fixtures/scenario');

const SPACE_ACTOR = {
  engineering: 'daniel',
  product: 'mei',
  design: 'jonas',
  support: 'aisha',
  people: 'elena',
  security: 'tomas',
  gtm: 'alice',
  planning: 'alice',
  platform: 'samir',
  data: 'samir',
  growth: 'mei',
  'support-emea': 'aisha',
  'gtm-emea': 'alice',
  'security-audit': 'tomas',
};

const RECOVERY = 'Run: ./nd db reset --yes && ./nd dev';

function blockBody(text) {
  return [
    {
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }],
    },
  ];
}

function elapsed(startedAt) {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

async function apiReachable() {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/v1/instance/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function realtimeReachable() {
  try {
    const res = await fetch(`${realtimeBaseUrl()}/api/health/v1`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Everything that must be true before the first write. */
async function preflight(plan) {
  if (!(await apiReachable())) {
    throw new Error(
      `The API is not reachable at ${apiBaseUrl()}. Start the full stack with \`./nd dev\` first.`
    );
  }
  if (!(await realtimeReachable())) {
    throw new Error(
      `The realtime server is not reachable at ${realtimeBaseUrl()}. ` +
        'Start the full stack with `./nd dev`; seeding writes documents through it.'
    );
  }

  const flyway = migrationState();
  if (!flyway.installed) {
    throw new Error(
      `The ${apiDatabase()} schema is not migrated. Run \`./nd db migrate\`, then retry.`
    );
  }
  if (flyway.pending !== 0 || flyway.failed !== 0) {
    throw new Error(
      `Flyway is not settled (${flyway.applied} applied, ${flyway.pending} pending, ${flyway.failed} failed). ` +
        'Run `./nd db info` and `./nd db migrate`.'
    );
  }

  const userCount = Number(queryValueFrom('SELECT count(*) FROM users'));
  const workspaceCount = Number(queryValueFrom('SELECT count(*) FROM workspaces'));
  const documentCount = Number(queryValueFrom('SELECT count(*) FROM documents'));
  if (userCount !== 0 || workspaceCount !== 0 || documentCount !== 0) {
    throw new Error(
      `The local database already has content (${userCount} users, ${workspaceCount} workspaces, ` +
        `${documentCount} documents). Seeding only runs on an empty database.`
    );
  }

  if (!tableExists(yhubDatabase(), 'yhub_ydoc_v1')) {
    throw new Error(
      `The ${yhubDatabase()} schema is not initialized. Run \`./nd db reset --yes\`.`
    );
  }
  const rooms = Number(queryValue(yhubDatabase(), 'SELECT count(*) FROM yhub_ydoc_v1'));
  const tombstones = Number(
    queryValue(yhubDatabase(), 'SELECT count(*) FROM yhub_ydoc_tombstones_v1')
  );
  if (rooms !== 0 || tombstones !== 0) {
    throw new Error(
      `The Yhub room store is not empty (${rooms} rooms, ${tombstones} tombstones). ` +
        'A hard delete leaves a permanent tombstone, so only a full reset makes the ids safe again.'
    );
  }

  // Fixture validation before any write: every referenced file, user, space and anchor
  // quote must resolve. Compiling here also warms the BlockNote schema once.
  const { Y } = await getConverter();
  const seenThreads = new Set();
  for (const doc of plan.documents) {
    if (!fs.existsSync(path.join(plan.contentDir, doc.file))) {
      throw new Error(`Fixture ${doc.key} references a missing Markdown file: ${doc.file}`);
    }
    if (!plan.users.some((user) => user.key === doc.author)) {
      throw new Error(`Fixture ${doc.key} has an unknown author: ${doc.author}`);
    }
    const compiled = await compileMarkdown(doc.markdown, doc.fileBlocks);
    doc.compiled = compiled;
    for (const thread of doc.comments) {
      const threadKey = `${doc.key}:${thread.index}`;
      if (seenThreads.has(threadKey)) throw new Error(`Duplicate thread fixture ${threadKey}`);
      seenThreads.add(threadKey);
      for (const participant of [
        thread.author,
        ...(thread.replies || []).map((reply) => reply.author),
        ...(thread.reactions || []).map((reaction) => reaction.author),
      ]) {
        if (!plan.users.some((user) => user.key === participant)) {
          throw new Error(`Thread ${threadKey} references an unknown user: ${participant}`);
        }
      }
      createAnchorSelection(compiled.doc, thread.anchor.quote, thread.anchor.occurrence, Y);
    }
  }

  const emails = new Set();
  for (const invite of plan.invites) {
    if (emails.has(invite.email)) throw new Error(`Duplicate invite email: ${invite.email}`);
    emails.add(invite.email);
  }

  info(
    `Preflight ok: ${plan.expectations.users} users, ${plan.expectations.spaces} spaces, ` +
      `${plan.expectations.documents} documents, ${plan.expectations.threads} threads.`
  );
}

function loginPool(plan, client) {
  // Every fixture user needs a session: space actors create the pages, and `--verify`
  // asserts each account can see its Shared section. The roster is the plan, not a
  // parallel list, so adding a fixture user cannot silently break verification.
  const wanted = plan.users.map((user) => user.key);
  const missing = new Set(
    plan.documents
      .map((doc) => SPACE_ACTOR[doc.spaceKey])
      .filter((key) => key && !wanted.includes(key))
  );
  if (missing.size > 0) {
    throw new Error(
      `The seed needs sessions for these actors but did not log in: ${[...missing].join(', ')}`
    );
  }
  return Promise.all(
    wanted.map(async (key) => {
      const user = plan.users.find((candidate) => candidate.key === key);
      const session = await client.login(user.email, scenario.PASSWORD);
      return { key, session };
    })
  ).then((entries) => Object.fromEntries(entries.map((entry) => [entry.key, entry.session])));
}

async function createDocuments(plan, sessions, run) {
  const total = plan.documents.length;
  let index = 0;
  for (const doc of plan.documents) {
    index += 1;
    const actorKey = doc.private ? doc.author : SPACE_ACTOR[doc.spaceKey];
    const session = sessions[actorKey];
    if (!session) throw new Error(`No session for ${doc.key} (actor ${actorKey})`);

    const response = await session.request('POST', '/api/v1/documents', {
      body: {
        id: doc.id,
        title: doc.title,
        ...(doc.parentId
          ? { parentId: doc.parentId }
          : doc.spaceId
            ? { spaceId: doc.spaceId }
            : {}),
        yjsState: doc.compiled.base64,
        // A creator *label*, not an id: the web client sends the display name here.
        createdBy: plan.users.find((user) => user.key === doc.author)?.name ?? doc.author,
        ...(doc.icon ? { icon: doc.icon } : {}),
      },
    });

    const id = response?.id;
    if (id !== doc.id) {
      throw new Error(`Create for ${doc.key} returned document ${id}, expected ${doc.id}`);
    }
    await waitForContent(session, doc);

    if (index % 10 === 0 || index === total) {
      info(`Created ${index}/${total} documents`);
    }
    run.documents.push({ planDoc: doc, id: doc.id, creator: actorKey });
  }
}

async function waitForContent(session, doc) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const content = await session.request('GET', `/api/v1/documents/${doc.id}/content`);
    if (content && content.content) return;
    if (Date.now() >= deadline) {
      throw new Error(`Document ${doc.key} has no readable content after 30s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function applySharing(plan, sessions) {
  for (const doc of plan.documents) {
    // Private pages normally have no grants; the two shared-private fixtures do.
    // Their owner is the only actor that can address collaborators on them.
    const actor = doc.private ? doc.author : SPACE_ACTOR[doc.spaceKey];
    const session = sessions[actor];
    if (!session) throw new Error(`No session for sharing ${doc.key} (actor ${actor})`);
    let changed = false;

    if (doc.publicLink) {
      await session.request('PATCH', `/api/v1/documents/${doc.id}/sharing`, {
        body: { generalAccessMode: 'ANYONE_WITH_LINK', linkAccessLevel: 'VIEW' },
      });
      changed = true;
    }
    if (doc.workspaceAccess) {
      await session.request('PATCH', `/api/v1/documents/${doc.id}/sharing`, {
        body: {
          workspaceAccessMode: doc.workspaceAccess.mode,
          workspaceAccessLevel: doc.workspaceAccess.level,
        },
      });
      changed = true;
    }
    for (const share of doc.sharing) {
      // The creator owns the page until authorship is reassigned at the end; the API
      // rejects a self-grant, and the creator already has the space grant anyway.
      if (share.user === actor) continue;
      const user = plan.users.find((candidate) => candidate.id === share.userId);
      await session.request('POST', `/api/v1/documents/${doc.id}/collaborators`, {
        body: { email: user.email, accessLevel: share.level },
      });
      changed = true;
    }
    if (changed && doc.comments.length > 0) {
      // A new collaborator must be able to read the body before the anchor call; the
      // access resolution is cached per request, so one read after the grants is enough.
      await session.request('GET', `/api/v1/documents/${doc.id}/content`);
    }
  }
}

async function createInvites(plan, session, run) {
  const pending = plan.invites.filter((invite) => invite.state === 'pending');
  if (pending.length === 0) return;
  let results;
  try {
    results = await session.request('POST', '/api/v1/workspaces/current/invites', {
      body: { emails: pending.map((invite) => invite.email), role: 'MEMBER' },
    });
  } catch (err) {
    if (err.status === 503) {
      throw new Error(
        'The API has no email delivery configured, so invitations cannot be sent. ' +
          '`./nd dev` starts Mailpit; start the full stack and retry.'
      );
    }
    throw err;
  }
  for (const invite of pending) {
    const result = (results || []).find((candidate) => candidate.email === invite.email);
    if (!result || result.status !== 'INVITED' || !result.invite) {
      throw new Error(
        `Invite for ${invite.email} was not created (${result?.status || 'no result'})`
      );
    }
    run.invites.push({ ...invite, id: result.invite.id });
  }
}

/**
 * A space member who has not reacted with this emoji yet. `comment_reactions` is unique
 * on (comment, user, emoji), so cycling an index over the member list would post the same
 * pair twice once a fixture has more same-emoji reactions than members.
 */
function reactorFor(plan, spaceKey, pool, used) {
  const space = plan.spaces.find((candidate) => candidate.key === spaceKey);
  const members = space.members
    .map((member) => plan.users.find((user) => user.id === member.userId))
    .filter(
      (user) =>
        user &&
        ['COMMENT', 'EDIT', 'OWNER'].includes(space.members.find((m) => m.userId === user.id).level)
    )
    .map((user) => user.key)
    .filter((key) => pool.includes(key));
  return members.find((key) => !used.has(key)) || null;
}

async function createComments(plan, client, sessions, run) {
  for (const doc of plan.documents) {
    if (doc.comments.length === 0) continue;
    const actorKey = SPACE_ACTOR[doc.spaceKey];
    const session = sessions[actorKey];
    const { Y } = await getConverter();

    for (const thread of doc.comments) {
      let created;
      try {
        created = await session.request('POST', `/api/v1/documents/${doc.id}/threads`, {
          body: { body: blockBody(thread.body) },
        });
      } catch (err) {
        throw new Error(`Thread creation failed for ${doc.key}: ${err.message}`);
      }
      const threadId = created.id;
      const record = {
        id: threadId,
        docKey: doc.key,
        planThread: thread,
        comments: [
          {
            id: created.comments[0].id,
            planComment: { author: thread.author, createdDaysAgo: thread.createdDaysAgo },
          },
        ],
        reactions: [],
        resolved: thread.resolved,
      };

      let anchorOk = false;
      for (let attempt = 0; attempt < 3 && !anchorOk; attempt += 1) {
        try {
          const selection = createAnchorSelection(
            doc.compiled.doc,
            thread.anchor.quote,
            thread.anchor.occurrence,
            Y
          );
          await client.anchor(
            doc.id,
            threadId,
            { anchor: selection.anchor, head: selection.head },
            session.token
          );
          anchorOk = true;
        } catch (err) {
          if (attempt === 2) {
            // A comment that cannot be highlighted is worse than no comment: the
            // dataset would claim an anchor that the editor cannot render.
            await session.request('DELETE', `/api/v1/documents/${doc.id}/threads/${threadId}`);
            throw new Error(
              `Anchor failed for ${doc.key} (${thread.anchor.quote}): ${err.message}`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }

      for (const reply of thread.replies || []) {
        const response = await session.request(
          'POST',
          `/api/v1/documents/${doc.id}/threads/${threadId}/comments`,
          { body: { body: blockBody(reply.body) } }
        );
        record.comments.push({
          id: response.id,
          planComment: { author: reply.author, createdDaysAgo: reply.createdDaysAgo },
        });
      }

      // The API rejects a second reaction by the same user with the same emoji, so each
      // emoji takes a different reactor. The fixture author is applied later.
      const reactorsByEmoji = new Map();
      for (const reaction of thread.reactions || []) {
        const commentId = record.comments[0].id;
        const used = reactorsByEmoji.get(reaction.emoji) || new Set();
        const reactorKey = reactorFor(plan, doc.spaceKey, Object.keys(sessions), used) || actorKey;
        if (used.has(reactorKey)) {
          throw new Error(
            `No unused space member is left to react ${reaction.emoji} on ${doc.key}; ` +
              'the fixture needs one reactor per same-emoji reaction.'
          );
        }
        used.add(reactorKey);
        reactorsByEmoji.set(reaction.emoji, used);
        await sessions[reactorKey].request(
          'POST',
          `/api/v1/documents/${doc.id}/threads/${threadId}/comments/${commentId}/reactions`,
          { body: { emoji: reaction.emoji } }
        );
        const reactorId = plan.users.find((user) => user.key === reactorKey).id;
        const reactionId = queryValueFrom(
          `SELECT id FROM comment_reactions WHERE comment_id = '${commentId}' AND emoji = ${sqlString(
            reaction.emoji
          )} AND user_id = '${reactorId}'`
        );
        if (!reactionId) {
          throw new Error(`Could not find the reaction row created for ${doc.key}`);
        }
        record.reactions.push({
          id: reactionId,
          targetUser: plan.users.find((user) => user.key === reaction.author).id,
        });
      }

      if (thread.resolved) {
        await session.request('POST', `/api/v1/documents/${doc.id}/threads/${threadId}/resolve`);
      }

      run.threads.push(record);
    }
  }
}

async function applyTrash(plan, sessions) {
  for (const doc of plan.documents) {
    if (doc.trashDaysAgo == null) continue;
    const actor = SPACE_ACTOR[doc.spaceKey];
    await sessions[actor].request('DELETE', `/api/v1/documents/${doc.id}`);
  }
}

async function applyArchive(plan, sessions) {
  for (const space of plan.spaces) {
    if (space.archivedDaysAgo == null) continue;
    await sessions.alice.request('POST', `/api/v1/spaces/${space.id}/archive`);
  }
}

function copyAndInsertAttachments(plan, run) {
  const storage = attachmentStoragePath();
  const assetsDir = path.join(__dirname, 'fixtures', 'assets');
  const byAuthor = new Map();
  {
    const statements = ['BEGIN;'];
    for (const attachment of plan.attachments) {
      const source = path.join(assetsDir, attachment.file);
      if (!fs.existsSync(source)) {
        throw new Error(
          `Attachment ${attachment.key} references a missing asset: ${attachment.file}`
        );
      }
      const bytes = fs.readFileSync(source);
      const target = path.join(storage, attachment.storageKey);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);

      const doc = plan.documents.find((candidate) => candidate.key === attachment.documentKey);
      const uploader = doc.authorId;
      statements.push(`
INSERT INTO attachments (id, document_id, uploaded_by, file_name, content_type, size_bytes,
                         storage_key, sha256, created_at)
VALUES (${[
        sqlString(attachment.id),
        sqlString(attachment.documentId),
        sqlString(uploader),
        sqlString(attachment.fileName),
        sqlString(attachment.contentType),
        bytes.length,
        sqlString(attachment.storageKey),
        sqlString(sha256Hex(bytes)),
        sqlDate(new Date()),
      ].join(', ')});`);
      byAuthor.set(uploader, (byAuthor.get(uploader) || 0) + bytes.length);
      run.attachments.push({ ...attachment, documentKey: doc.key, sizeBytes: bytes.length });
    }
    for (const [userId, bytes] of byAuthor) {
      statements.push(`
INSERT INTO attachment_usage (user_id, used_bytes, updated_at)
VALUES (${sqlString(userId)}, ${bytes}, now())
ON CONFLICT (user_id) DO UPDATE
SET used_bytes = attachment_usage.used_bytes + EXCLUDED.used_bytes, updated_at = now();`);
    }
    statements.push('COMMIT;');
    runSql(statements.join('\n'));
  }
  info(`Copied ${plan.attachments.length} attachment files to ${storage}`);
}

/** Reassign the actor-pool authorship the construct could not log in for. */
function reassignAuthorship(run) {
  const statements = ['BEGIN;'];
  // Documents keep the owner the creating actor gave them. V11 states the invariant:
  // `child.user_id == parent.user_id`, because a subtree's ownership follows its tree
  // root and creators are recorded in `created_by`. Writing the fixture author into
  // `user_id` produced subtrees whose nested pages were owned by someone other than
  // their parent (and whose `space_id IS NULL` then read as an OWNER grant for that
  // author). `createDocuments` already sends the fixture author as the `createdBy`
  // label, so the visible authorship is unchanged.
  for (const thread of run.threads) {
    const author = run.plan.users.find((user) => user.key === thread.planThread.author);
    const resolved =
      thread.resolved && thread.planThread.resolvedDaysAgo != null
        ? `, resolved_by_user_id = '${author.id}', resolved_by_user_key = '${author.id}', resolved_by_name = ${sqlString(author.name)}`
        : '';
    statements.push(
      `UPDATE comment_threads SET created_by_user_id = '${author.id}'${resolved} WHERE id = '${thread.id}';`
    );
    for (const comment of thread.comments) {
      const commentAuthor = run.plan.users.find((user) => user.key === comment.planComment.author);
      statements.push(
        `UPDATE comments SET author_user_id = '${commentAuthor.id}', author_user_key = '${commentAuthor.id}', ` +
          `author_name = ${sqlString(commentAuthor.name)} WHERE id = '${comment.id}';`
      );
    }
    for (const reaction of thread.reactions) {
      statements.push(
        `UPDATE comment_reactions SET user_id = '${reaction.targetUser}' WHERE id = '${reaction.id}';`
      );
    }
  }
  statements.push('COMMIT;');
  runSql(statements.join('\n'));
}

function printSummary(plan, run, startedAt) {
  const e = plan.expectations;
  console.log('');
  success('Seed complete.');
  console.log(`  profile      ${plan.profile}`);
  console.log(`  workspace    ${plan.workspace.name}`);
  console.log(`  users        ${e.users}`);
  console.log(`  spaces       ${e.spaces} (${e.archivedSpaces} archived)`);
  console.log(`  documents    ${e.documents} (${e.trashed} in trash)`);
  console.log(`  threads      ${e.threads}`);
  console.log(`  comments     ${e.comments} (${e.reactions} reactions)`);
  console.log(`  attachments  ${e.attachments}`);
  console.log(`  invites      ${e.invites}`);
  console.log(`  elapsed      ${elapsed(startedAt)}`);
  console.log('');
  const keys = plan.users.map((user) => user.key);
  const shown = keys.length <= 8 ? keys.join(', ') : `${keys.slice(0, 6).join(', ')}, ...`;
  console.log('Demo login:');
  console.log(`  email        ${plan.users[0].email}`);
  console.log(`  password     ${scenario.PASSWORD}`);
  console.log(`  accounts     <key>@nextdocs.test (${shown}; ${keys.length} users)`);
  console.log('');
  console.log('Next: ./nd db status    # Flyway stays clean after seeding');
}

async function runSeed(args, startedAt) {
  const plan = buildPlan(args.profile);
  const instance = getInstance();
  // SQL always targets this worktree; inherited URLs must not send HTTP to another one.
  process.env.NEXTDOCS_API_URL = `http://localhost:${instance.ports.api}`;
  process.env.NEXTDOCS_REALTIME_URL = `http://localhost:${instance.ports.realtime}`;

  if (!args.yes) {
    const confirmed = await confirmDestructive({
      headline: 'This will seed the local databases (they must be empty):',
      details: [
        `workspace: ${plan.workspace.name}`,
        `users: ${plan.expectations.users}, spaces: ${plan.expectations.spaces}, documents: ${plan.expectations.documents}`,
        `attachments: ${plan.expectations.attachments} files under ${attachmentStoragePath()}`,
      ],
      yes: args.yes,
    });
    if (!confirmed) return 1;
  }

  assertLocalDatabase('seed');
  await preflight(plan);

  info('Writing identity rows...');
  insertIdentity(plan);
  args.seedWritten = true;
  plan.users.forEach((user) => {
    if (!user.id) throw new Error(`User ${user.key} has no id`);
  });

  const client = new Client({
    apiBaseUrl: apiBaseUrl(),
    realtimeBaseUrl: realtimeBaseUrl(),
    password: scenario.PASSWORD,
    verbose: args.verbose,
  });
  info('Logging in the actor pool...');
  const sessions = await loginPool(plan, client);

  const run = {
    plan,
    documents: [],
    threads: [],
    attachments: [],
    invites: [],
  };

  info('Creating documents...');
  await createDocuments(plan, sessions, run);
  info('Applying sharing...');
  await applySharing(plan, sessions);
  info('Issuing invites...');
  await createInvites(plan, sessions.alice, run);
  info('Creating comments and anchors...');
  await createComments(plan, client, sessions, run);
  info('Moving documents to trash and archiving the planning space...');
  await applyTrash(plan, sessions);
  await applyArchive(plan, sessions);
  info('Copying attachments...');
  copyAndInsertAttachments(plan, run);

  info('Reassigning authorship to the fixture people...');
  reassignAuthorship(run);

  info('Backdating the timeline...');
  await backdate(run);

  if (args.verify) {
    await verifySeed(run, sessions);
  }

  printSummary(plan, run, startedAt);
  return 0;
}

async function main(argv) {
  const startedAt = Date.now();
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    error(err.message);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  try {
    return await runSeed(args, startedAt);
  } catch (err) {
    error(err.message);
    if (err.stack && process.env.SEED_DEBUG === '1') console.error(err.stack);
    if (args.seedWritten) console.error(RECOVERY);
    return 1;
  }
}

module.exports = main;
