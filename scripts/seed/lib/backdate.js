'use strict';

const { sleep, info, warn } = require('../../lib/proc');
const { queryValueFrom, queryRows, sqlDate, runSql } = require('./sql');
const { dateDaysAgo, afterOrEqual } = require('./time');

const DEFAULT_QUIET_MS = Number(process.env.SEED_QUIET_MS || 12_000);
const QUIET_TIMEOUT_MS = Number(process.env.SEED_QUIET_TIMEOUT_MS || 180_000);

/**
 * Yhub debounces compaction for 10 seconds per room and then calls the API's
 * content-updated hook, which moves `documents.updated_at`. Backdating before that
 * settles would be overwritten by the last compaction. Twelve seconds leaves two
 * seconds of headroom over the debounce; `SEED_QUIET_MS` can raise it on a slow host.
 * This is the one slow step in a seed, and it is never skipped silently.
 */
async function waitForCompactionQuiet({
  quietMs = DEFAULT_QUIET_MS,
  timeoutMs = QUIET_TIMEOUT_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    const pending = Number(
      queryValueFrom(
        `SELECT count(*) FROM documents WHERE updated_at > now() - interval '${quietMs} milliseconds'`
      )
    );
    if (pending === 0) {
      if (announced) info('Compaction is quiet.');
      return;
    }
    if (!announced) {
      info(
        `Waiting ${Math.round(quietMs / 1000)}s for Yhub compaction to settle (${pending} recent writes)...`
      );
      announced = true;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Yhub compaction did not settle within ${Math.round(timeoutMs / 1000)}s; ` +
          'refusing to backdate a document that is still being rewritten.'
      );
    }
    await sleep(2000);
  }
}

function timelineOf(run) {
  const docById = new Map();
  for (const doc of run.documents) {
    const created = dateDaysAgo(doc.planDoc.createdDaysAgo, `doc:${doc.planDoc.key}:created`);
    const updated = afterOrEqual(
      dateDaysAgo(doc.planDoc.updatedDaysAgo, `doc:${doc.planDoc.key}:updated`),
      created,
      `doc:${doc.planDoc.key}:updated`
    );
    const deleted =
      doc.planDoc.trashDaysAgo != null
        ? afterOrEqual(
            dateDaysAgo(doc.planDoc.trashDaysAgo, `doc:${doc.planDoc.key}:deleted`),
            updated,
            `doc:${doc.planDoc.key}:deleted`
          )
        : null;
    doc.createdAt = created;
    doc.updatedAt = updated;
    doc.deletedAt = deleted;
    docById.set(doc.planDoc.key, doc);
  }

  for (const thread of run.threads) {
    const doc = docById.get(thread.docKey);
    const created = afterOrEqual(
      dateDaysAgo(
        thread.planThread.createdDaysAgo,
        `thread:${thread.docKey}:${thread.planThread.index}:created`
      ),
      doc.createdAt,
      'thread'
    );
    thread.createdAt = created;
    let last = created;
    for (const comment of thread.comments) {
      const at = afterOrEqual(
        dateDaysAgo(comment.planComment.createdDaysAgo, `comment:${comment.id}:created`),
        last,
        'comment'
      );
      comment.createdAt = at;
      last = at;
    }
    thread.updatedAt = last;
    thread.resolvedAt =
      thread.planThread.resolved && thread.planThread.resolvedDaysAgo != null
        ? afterOrEqual(
            dateDaysAgo(thread.planThread.resolvedDaysAgo, `thread:${thread.docKey}:resolved`),
            last,
            'resolved'
          )
        : null;
    if (thread.resolvedAt && thread.resolvedAt.getTime() > thread.updatedAt.getTime()) {
      thread.updatedAt = thread.resolvedAt;
    }
  }
}

function buildBackdateSql(run) {
  const statements = ['BEGIN;'];

  for (const doc of run.documents) {
    statements.push(
      `UPDATE documents SET created_at = ${sqlDate(doc.createdAt)}, updated_at = ${sqlDate(
        doc.updatedAt
      )}, deleted_at = ${sqlDate(doc.deletedAt)} WHERE id = '${doc.id}';`
    );
    // content_version tracks indexed_at in the content upsert; leaving it at the real
    // seed instant while indexed_at moves into the past would mark every seeded row
    // stale, and the reconcile crawl would re-extract the whole corpus on its next pass.
    statements.push(
      `UPDATE document_search SET source_produced_at = ${sqlDate(doc.updatedAt)}, indexed_at = ${sqlDate(
        doc.updatedAt
      )}, content_version = ${sqlDate(doc.updatedAt)} WHERE document_id = '${doc.id}';`
    );
    statements.push(
      `UPDATE access_grants SET created_at = ${sqlDate(doc.createdAt)}, updated_at = ${sqlDate(
        doc.updatedAt
      )} WHERE document_id = '${doc.id}';`
    );
    statements.push(
      `UPDATE user_document_orders SET created_at = ${sqlDate(doc.createdAt)}, updated_at = ${sqlDate(
        doc.updatedAt
      )} WHERE document_id = '${doc.id}';`
    );
    statements.push(
      `UPDATE user_shared_document_orders SET created_at = ${sqlDate(
        doc.createdAt
      )}, updated_at = ${sqlDate(doc.updatedAt)} WHERE document_id = '${doc.id}';`
    );
  }

  for (const thread of run.threads) {
    const resolvedBy = thread.resolvedAt ? `, resolved_at = ${sqlDate(thread.resolvedAt)}` : '';
    statements.push(
      `UPDATE comment_threads SET created_at = ${sqlDate(thread.createdAt)}, updated_at = ${sqlDate(
        thread.updatedAt
      )}${resolvedBy} WHERE id = '${thread.id}';`
    );
    for (const comment of thread.comments) {
      statements.push(
        `UPDATE comments SET created_at = ${sqlDate(comment.createdAt)}, updated_at = ${sqlDate(
          comment.createdAt
        )} WHERE id = '${comment.id}';`
      );
    }
    statements.push(
      `UPDATE comment_reactions SET created_at = ${sqlDate(
        thread.comments[0].createdAt
      )} WHERE comment_id IN (SELECT id FROM comments WHERE thread_id = '${thread.id}');`
    );
  }

  for (const attachment of run.attachments) {
    const doc = run.documents.find((candidate) => candidate.planDoc.key === attachment.documentKey);
    statements.push(
      `UPDATE attachments SET created_at = ${sqlDate(doc ? doc.createdAt : new Date())} WHERE id = '${attachment.id}';`
    );
  }

  for (const invite of run.invites) {
    if (invite.state === 'pending') {
      const created = dateDaysAgo(invite.createdDaysAgo, `invite:${invite.key}:created`);
      const expires = dateDaysAgo(-invite.expiresInDays, `invite:${invite.key}:expires`);
      statements.push(
        `UPDATE workspace_invites SET created_at = ${sqlDate(created)}, expires_at = ${sqlDate(expires)} WHERE id = '${invite.id}';`
      );
    }
  }

  // Identity rows are inserted with final timestamps, but re-applying them keeps the
  // whole timeline in one transaction, which is what the plan asks reviewers to reason
  // about.
  const workspaceCreated = dateDaysAgo(run.plan.workspace.createdDaysAgo, 'workspace:created');
  statements.push(
    `UPDATE workspaces SET created_at = ${sqlDate(workspaceCreated)}, updated_at = ${sqlDate(
      workspaceCreated
    )} WHERE id = '${run.plan.workspace.id}';`
  );
  for (const user of run.plan.users) {
    const joined = dateDaysAgo(user.joinedDaysAgo, `user:${user.key}`);
    statements.push(
      `UPDATE users SET created_at = ${sqlDate(joined)}, updated_at = ${sqlDate(joined)} WHERE id = '${user.id}';`
    );
    statements.push(
      `UPDATE workspace_members SET created_at = ${sqlDate(joined)} WHERE user_id = '${user.id}';`
    );
  }
  for (const space of run.plan.spaces) {
    const created = dateDaysAgo(space.createdDaysAgo, `space:${space.key}`);
    const archived =
      space.archivedDaysAgo != null
        ? dateDaysAgo(space.archivedDaysAgo, `space:${space.key}:archived`)
        : null;
    statements.push(
      `UPDATE spaces SET created_at = ${sqlDate(created)}, updated_at = ${sqlDate(created)}, ` +
        `archived_at = ${sqlDate(archived)} WHERE id = '${space.id}';`
    );
    statements.push(
      `UPDATE space_members SET created_at = ${sqlDate(created)}, updated_at = ${sqlDate(
        created
      )} WHERE space_id = '${space.id}';`
    );
    statements.push(
      `UPDATE user_space_orders SET created_at = ${sqlDate(created)}, updated_at = ${sqlDate(
        created
      )} WHERE space_id = '${space.id}';`
    );
  }

  for (const attachment of run.attachments) {
    const doc = run.documents.find((candidate) => candidate.planDoc.key === attachment.documentKey);
    if (doc) {
      statements.push(
        `UPDATE attachment_usage SET updated_at = ${sqlDate(doc.createdAt)} WHERE user_id = '${doc.planDoc.authorId}';`
      );
    }
  }

  statements.push('COMMIT;');
  return statements.join('\n');
}

async function applyTimeline(run) {
  timelineOf(run);
  const appliedAt = new Date();
  runSql(buildBackdateSql(run));
  return appliedAt;
}

/** A late content-updated would set updated_at to a time after we applied the timeline. */
function lateWritesSince(appliedAt) {
  const value = queryValueFrom(
    `SELECT count(*) FROM documents WHERE updated_at > ${sqlDate(appliedAt)}`
  );
  return Number(value);
}

async function backdate(run, options = {}) {
  const quietMs = options.quietMs || DEFAULT_QUIET_MS;
  await waitForCompactionQuiet(options);
  let appliedAt = await applyTimeline(run);

  // The backdated rows are older than the quiet window, so a second quiet probe would
  // return immediately and miss a compaction still inside Yhub's 10s debounce. Wait the
  // window out in wall time before checking for a late write.
  await sleep(quietMs);

  if (lateWritesSince(appliedAt) > 0) {
    warn(
      'A late Yhub compaction moved updated_at after backdating; re-applying the timeline once.'
    );
    appliedAt = await applyTimeline(run);
    await sleep(quietMs);
    if (lateWritesSince(appliedAt) > 0) {
      throw new Error(
        'Backdating did not stick: a Yhub compaction keeps rewriting documents.updated_at. ' +
          'Stop editing the seeded rooms and re-run the seed after a reset.'
      );
    }
  }

  return run;
}

/** Chronology invariants, as one query so a failure names the table and the row. */
function chronologyViolations() {
  // `queryRows`, not `queryValue`: a value query keeps only the first line, which
  // silently truncated a `UNION ALL` that found more than one broken row.
  const rows = queryRows(`
SELECT 'document' AS kind, id::text FROM documents WHERE updated_at < created_at
UNION ALL
SELECT 'document-trash', id::text FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < created_at
UNION ALL
SELECT 'thread-before-document', t.id::text FROM comment_threads t JOIN documents d ON d.id = t.document_id WHERE t.created_at < d.created_at
UNION ALL
SELECT 'comment-before-thread', c.id::text FROM comments c JOIN comment_threads t ON t.id = c.thread_id WHERE c.created_at < t.created_at
UNION ALL
SELECT 'thread-updated-before-created', id::text FROM comment_threads WHERE updated_at < created_at
UNION ALL
SELECT 'reaction-before-comment', r.id::text FROM comment_reactions r JOIN comments c ON c.id = r.comment_id WHERE r.created_at < c.created_at
UNION ALL
SELECT 'invite-expiry', id::text FROM workspace_invites WHERE expires_at <= created_at
UNION ALL
SELECT 'invite-accepted-before-created', id::text FROM workspace_invites WHERE accepted_at IS NOT NULL AND accepted_at < created_at
UNION ALL
SELECT 'space-before-workspace', s.id::text FROM spaces s JOIN workspaces w ON w.id = s.workspace_id WHERE s.created_at < w.created_at
UNION ALL
SELECT 'document-before-space', d.id::text FROM documents d JOIN spaces s ON s.id = d.space_id WHERE d.created_at < s.created_at
UNION ALL
SELECT 'user-before-workspace', u.id::text FROM users u JOIN workspaces w ON w.id = (SELECT workspace_id FROM workspace_members wm WHERE wm.user_id = u.id LIMIT 1) WHERE u.created_at < w.created_at;
`);
  return rows.map(([kind, id]) => `${kind}: ${id}`);
}

module.exports = {
  DEFAULT_QUIET_MS,
  waitForCompactionQuiet,
  applyTimeline,
  backdate,
  chronologyViolations,
  lateWritesSince,
};
