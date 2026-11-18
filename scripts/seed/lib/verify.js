'use strict';

const { info, success, error, sleep } = require('../../lib/proc');
const { getConverter, decodeUpdate, plainTextOf, commentThreadIdsOf } = require('./markdown');
const { chronologyViolations } = require('./backdate');
const { queryRows } = require('./sql');
const { apiBaseUrl } = require('../../lib/constants');

const SEARCH_CASES = [
  { term: 'harbor-ingest', document: 'eng/adr-event-ingestion' },
  { term: 'core collaboration hours', document: 'people/handbook' },
  { term: 'saved segment', document: 'product/prd-saved-segments' },
  { term: 'paging policy', document: 'eng/on-call-runbook' },
  { term: 'CSV import', document: 'support/known-issues-csv-import' },
];

function sessionForSpace(run, sessions, doc) {
  if (doc.planDoc.private) return sessions[doc.planDoc.author] || sessions.alice;
  const space = run.plan.spaces.find((candidate) => candidate.id === doc.planDoc.spaceId);
  if (!space) return sessions.alice;
  for (const member of space.members) {
    if (!['EDIT', 'OWNER'].includes(member.level)) continue;
    const user = run.plan.users.find((candidate) => candidate.id === member.userId);
    if (user && sessions[user.key]) return sessions[user.key];
  }
  return sessions.alice;
}

async function verifyCounts(run, failures) {
  const rows = queryRows(
    `SELECT
       (SELECT count(*) FROM users),
       (SELECT count(*) FROM workspaces),
       (SELECT count(*) FROM workspaces WHERE icon_type IS NOT NULL),
       (SELECT count(*) FROM spaces WHERE archived_at IS NULL),
       (SELECT count(*) FROM spaces WHERE archived_at IS NOT NULL),
       (SELECT count(*) FROM documents),
       (SELECT count(*) FROM documents WHERE icon_type IS NOT NULL),
       (SELECT count(*) FROM documents WHERE deleted_at IS NOT NULL),
       (SELECT count(*) FROM comment_threads),
       (SELECT count(*) FROM comments),
       (SELECT count(*) FROM comment_reactions),
       (SELECT count(*) FROM attachments),
       (SELECT count(*) FROM workspace_invites),
       (SELECT count(*) FROM workspace_invites WHERE accepted_at IS NULL AND expires_at > now()),
       (SELECT count(*) FROM workspace_invites WHERE accepted_at IS NULL AND expires_at <= now()),
       (SELECT count(*) FROM workspace_invites WHERE accepted_at IS NOT NULL)`
  );
  const values = (rows[0] || []).map(Number);
  const [
    users,
    workspaces,
    workspacesWithIcons,
    activeSpaces,
    archivedSpaces,
    documents,
    documentsWithIcons,
    trashed,
    threads,
    comments,
    reactions,
    attachments,
    invites,
    pendingInvites,
    expiredInvites,
    acceptedInvites,
  ] = values;
  const e = run.plan.expectations;

  const expect = (actual, wanted, label) => {
    if (actual !== wanted) failures.push(`${label}: expected ${wanted}, found ${actual}`);
  };
  expect(users, e.users, 'users');
  expect(workspaces, 1, 'workspaces');
  expect(workspacesWithIcons, 1, 'workspaces with icons');
  expect(documents, e.documents, 'documents');
  expect(documentsWithIcons, e.documents, 'documents with icons');
  expect(trashed, e.trashed, 'trashed documents');
  expect(activeSpaces + archivedSpaces, e.spaces, 'spaces');
  expect(archivedSpaces, e.archivedSpaces, 'archived spaces');
  expect(threads, e.threads, 'threads');
  expect(comments, e.comments, 'comments');
  expect(reactions, e.reactions, 'reactions');
  expect(attachments, e.attachments, 'attachments');
  expect(invites, e.invites, 'invites');
  expect(pendingInvites, 2, 'pending invites');
  expect(expiredInvites, 1, 'expired invites');
  expect(acceptedInvites, 1, 'accepted invites');

  const violations = chronologyViolations();
  if (violations.length > 0) {
    failures.push(`chronology: ${violations.slice(0, 5).join(', ')}`);
  }

  const ownerMismatches = ownershipViolations();
  if (ownerMismatches.length > 0) {
    failures.push(
      `ownership: ${ownerMismatches.length} page(s) disagree with their tree root ` +
        `(${ownerMismatches.slice(0, 5).join(', ')})`
    );
  }
}

/**
 * V11's ownership invariant: a nested page belongs to whoever owns its tree root, because
 * a subtree's access flows through the root. The seed creates a space's pages through one
 * actor, so a mismatch here would mean the row resolves a different owner than the API's
 * own resolver would give it.
 */
function ownershipViolations() {
  return queryRows(`
WITH RECURSIVE tree AS (
    SELECT d.id, d.user_id AS root_owner
      FROM documents d
     WHERE d.parent_id IS NULL

    UNION ALL

    SELECT d.id, t.root_owner
      FROM documents d
      JOIN tree t ON d.parent_id = t.id
)
SELECT doc.id::text
  FROM documents doc
  JOIN tree ON doc.id = tree.id
 WHERE doc.user_id <> tree.root_owner
`).map(([id]) => id);
}

async function verifyContent(run, failures) {
  const { Y } = await getConverter();
  const decodedByDoc = new Map();
  for (const doc of run.documents) {
    const session = sessionForSpace(run, run.sessions, doc);
    let content;
    try {
      content = await session.request(
        'GET',
        `/api/v1/documents/${doc.id}/content${doc.planDoc.trashDaysAgo != null ? '?includeTrashed=true' : ''}`
      );
    } catch (err) {
      failures.push(`content: ${doc.planDoc.key} read failed (${err.status || 'network'})`);
      continue;
    }
    if (!content || !content.content) {
      failures.push(`content: ${doc.planDoc.key} is empty`);
      continue;
    }
    const decoded = decodeUpdate(content.content, Y);
    const text = plainTextOf(decoded, Y);
    if (text !== doc.planDoc.compiled.text) {
      failures.push(`content: ${doc.planDoc.key} decoded text does not match the fixture`);
    }
    decodedByDoc.set(doc.id, decoded);
  }

  let anchorsChecked = 0;
  for (const thread of run.threads) {
    const doc = run.documents.find((candidate) => candidate.planDoc.key === thread.docKey);
    const decoded = decodedByDoc.get(doc.id);
    if (!decoded) continue;
    const ids = commentThreadIdsOf(decoded);
    if (!ids.has(thread.id)) {
      failures.push(`anchor: thread ${thread.id} on ${thread.docKey} has no comment mark`);
    } else {
      anchorsChecked += 1;
    }
  }
  if (anchorsChecked !== run.threads.length) {
    failures.push(`anchors: verified ${anchorsChecked}/${run.threads.length}`);
  }
}

async function verifySearch(run, failures) {
  const session = run.sessions.alice;
  const deadline = Date.now() + 60_000;
  const missing = new Map();
  for (const searchCase of SEARCH_CASES) {
    missing.set(searchCase.term, searchCase);
  }

  for (;;) {
    for (const [term, searchCase] of [...missing]) {
      const expected = run.documents.find((doc) => doc.planDoc.key === searchCase.document);
      if (!expected) {
        missing.delete(term);
        continue;
      }
      const result = await session.request(
        'GET',
        `/api/v1/search?q=${encodeURIComponent(term)}&limit=50`
      );
      const ids = (result?.items || []).map((item) => item.documentId);
      if (ids.includes(expected.id)) missing.delete(term);
    }
    if (missing.size === 0) return;
    if (Date.now() >= deadline) break;
    await sleep(3000);
  }

  for (const searchCase of missing.values()) {
    failures.push(`search: '${searchCase.term}' did not return ${searchCase.document}`);
  }
}

async function expectStatus(session, method, path, status, body) {
  try {
    const response = await session.request(method, path, { body, withStatus: true });
    return { ok: response.status === status, status: response.status };
  } catch (err) {
    // A network failure has no status; report it as such instead of a bogus 200.
    return { ok: err.status === status, status: err.status || 'network error' };
  }
}

async function verifyAccess(run, failures) {
  const sessions = run.sessions;

  const publicDoc = run.documents.find((doc) => doc.planDoc.publicLink);
  if (publicDoc) {
    for (const suffix of ['public', 'public/content']) {
      try {
        const res = await fetch(`${apiBaseUrl()}/api/v1/documents/${publicDoc.id}/${suffix}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok)
          failures.push(
            `access: anonymous ${suffix} for ${publicDoc.planDoc.key} returned ${res.status}`
          );
      } catch (err) {
        failures.push(
          `access: anonymous ${suffix} for ${publicDoc.planDoc.key} failed: ${err.message}`
        );
      }
    }
  }

  // Derive the pair from the plan instead of naming one fixture: the small profile has
  // fewer spaces, and a missing lookup used to turn this check into a silent skip.
  const outsider = sessions.daniel;
  const outsiderPrivateDoc = run.documents.find(
    (doc) =>
      doc.planDoc.private &&
      !doc.planDoc.sharedPrivate &&
      doc.planDoc.author !== 'daniel' &&
      !doc.planDoc.sharing.some((share) => share.user === 'daniel')
  );
  if (!outsider) {
    failures.push('access: no session for daniel');
  } else if (!outsiderPrivateDoc) {
    failures.push('access: no private document exists to test isolation against');
  } else {
    const result = await expectStatus(
      outsider,
      'GET',
      `/api/v1/documents/${outsiderPrivateDoc.id}`,
      404
    );
    if (!result.ok) {
      failures.push(
        `access: an outsider can read ${outsiderPrivateDoc.planDoc.key} (status ${result.status})`
      );
    }
  }

  const workspaceDoc = run.documents.find((doc) => doc.planDoc.workspaceAccess);
  if (workspaceDoc && outsider) {
    const result = await expectStatus(outsider, 'GET', `/api/v1/documents/${workspaceDoc.id}`, 200);
    if (!result.ok) {
      failures.push(`access: a workspace member cannot read ${workspaceDoc.planDoc.key}`);
    }
  }

  // The sidebar should never show an empty Shared section. Each fixture account must
  // see at least one page there, including the owner of a shared private page.
  for (const user of run.plan.users) {
    const session = sessions[user.key];
    if (!session) {
      failures.push(`shared: no session for ${user.key}`);
      continue;
    }
    const listing = await session.request('GET', '/api/v1/documents?scope=shared&size=10');
    const items = listing?.content || listing?.items || [];
    if (items.length === 0) {
      failures.push(`shared: ${user.key} has an empty Shared section`);
    }
  }

  for (const doc of run.documents.filter((candidate) => candidate.planDoc.sharedPrivate)) {
    const recipient = doc.planDoc.sharing[0];
    const recipientSession = recipient ? sessions[recipient.user] : null;
    if (!recipientSession) {
      failures.push(`shared: ${doc.planDoc.key} has no session for its first recipient`);
      continue;
    }
    const result = await expectStatus(recipientSession, 'GET', `/api/v1/documents/${doc.id}`, 200);
    if (!result.ok) {
      failures.push(
        `shared: ${doc.planDoc.key} is not readable by ${recipient.user} (status ${result.status})`
      );
    }
  }

  for (const doc of run.documents.filter((candidate) => candidate.planDoc.trashDaysAgo != null)) {
    const session = sessionForSpace(run, sessions, doc);
    const result = await expectStatus(
      session,
      'GET',
      `/api/v1/documents/${doc.id}?includeTrashed=true`,
      200
    );
    if (!result.ok) failures.push(`trash: ${doc.planDoc.key} is not readable in the trash view`);
  }

  const archived = run.plan.spaces.find((space) => space.archivedDaysAgo != null);
  if (archived) {
    const active = await sessions.alice.request('GET', '/api/v1/spaces?archived=false');
    if ((active || []).some((space) => space.id === archived.id)) {
      failures.push(`archive: ${archived.key} still appears in the active sidebar`);
    }
    const archivedList = await sessions.alice.request('GET', '/api/v1/spaces?archived=true');
    if (!(archivedList || []).some((space) => space.id === archived.id)) {
      failures.push(`archive: ${archived.key} is missing from the archived spaces`);
    }
  }

  const inviteList = await sessions.alice.request(
    'GET',
    '/api/v1/workspaces/current/invites?size=50'
  );
  const emails = new Set(
    (inviteList?.content || inviteList?.items || []).map((invite) => invite.email)
  );
  for (const invite of run.plan.invites) {
    if (invite.state === 'accepted') continue;
    if (!emails.has(invite.email))
      failures.push(`invites: ${invite.email} (${invite.state}) is not listed`);
  }
}

async function verifyAttachments(run, failures) {
  for (const attachment of run.attachments) {
    const doc = run.documents.find((candidate) => candidate.planDoc.key === attachment.documentKey);
    const session = sessionForSpace(run, run.sessions, doc);
    let url;
    try {
      url = await session.request('GET', `/api/v1/attachments/${attachment.id}/url`);
    } catch (err) {
      failures.push(`attachments: ${attachment.key} URL failed (${err.status || 'network'})`);
      continue;
    }
    if (!url?.url) {
      failures.push(`attachments: ${attachment.key} returned no signed URL`);
      continue;
    }
    const absoluteUrl = url.url.startsWith('http') ? url.url : `${apiBaseUrl()}${url.url}`;
    const response = await fetch(absoluteUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      failures.push(`attachments: ${attachment.key} download returned ${response.status}`);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = attachment.sizeBytes;
    if (expected != null && bytes.length !== expected) {
      failures.push(
        `attachments: ${attachment.key} returned ${bytes.length} bytes, expected ${expected}`
      );
    }
  }
}

async function verifySeed(run, sessions) {
  run.sessions = sessions;
  info('Verifying counts, chronology, content, anchors, search, access and attachments...');
  const failures = [];
  await verifyCounts(run, failures);
  await verifyContent(run, failures);
  await verifySearch(run, failures);
  await verifyAccess(run, failures);
  await verifyAttachments(run, failures);

  if (failures.length > 0) {
    error(`Verification failed (${failures.length}):`);
    for (const failure of failures) error(`  - ${failure}`);
    throw new Error('Seed verification failed');
  }
  success('Verification passed.');
}

module.exports = { verifySeed, SEARCH_CASES };
