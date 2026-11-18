'use strict';

const fs = require('fs');
const path = require('path');
const { seedId } = require('./ids');
const scenario = require('../fixtures/scenario');

const CONTENT_DIR = path.join(__dirname, '..', 'fixtures', 'content');
const LARGE_DOCUMENT_COUNT = 100;
const LARGE_TOPICS = [
  'Workspace retention',
  'Event replay controls',
  'Search freshness',
  'Usage reporting',
  'Permission audits',
  'Attachment lifecycle',
  'Import validation',
  'Regional failover',
  'Notification delivery',
  'API pagination',
  'Comment moderation',
  'Billing reconciliation',
  'Data export',
  'Onboarding progress',
  'Queue capacity',
  'Release readiness',
  'Workspace migration',
  'Customer handoff',
  'Incident follow-up',
  'Accessibility review',
];
const LARGE_GROUPS = [
  {
    key: 'engineering',
    label: 'Engineering',
    space: 'engineering',
    parent: 'eng/engineering-handbook',
    author: 'daniel',
  },
  {
    key: 'product',
    label: 'Product',
    space: 'product',
    parent: 'product/roadmap-2026',
    author: 'mei',
  },
  {
    key: 'support',
    label: 'Support',
    space: 'support',
    parent: 'support/escalation-matrix',
    author: 'aisha',
  },
  {
    key: 'design',
    label: 'Design',
    space: 'design',
    parent: 'design/design-tokens',
    author: 'jonas',
  },
  {
    key: 'people',
    label: 'People Ops',
    space: 'people',
    parent: 'people/handbook',
    author: 'elena',
  },
];
const LARGE_FORMATS = [
  'generated/feature-brief.md',
  'generated/runbook.md',
  'generated/decision-record.md',
  'generated/data-catalog.md',
];

function readMarkdown(file, variables = {}) {
  return fs
    .readFileSync(path.join(CONTENT_DIR, file), 'utf8')
    .replace(/{{(\w+)}}/g, (match, key) => {
      if (!(key in variables)) throw new Error(`Markdown fixture ${file} needs value for ${key}`);
      return variables[key];
    });
}

const PRIVATE_TEMPLATES = [
  {
    key: 'weekly-review',
    title: 'Weekly review',
    file: 'private/weekly-review.md',
    icon: { type: 'BUILTIN', value: 'book-open-bookmark', color: 'gray' },
  },
  {
    key: 'one-on-one',
    title: 'One-on-one agenda',
    file: 'private/one-on-one.md',
    icon: { type: 'BUILTIN', value: 'multiple-users-1', color: 'green' },
  },
  {
    key: 'project-brief',
    title: 'Project brief',
    file: 'private/project-brief.md',
    icon: { type: 'BUILTIN', value: 'target-center-monitor', color: 'purple' },
  },
  {
    key: 'research-notes',
    title: 'Research notes',
    file: 'private/research-notes.md',
    icon: { type: 'BUILTIN', value: 'book-search', color: 'blue' },
  },
  {
    key: 'decision-log',
    title: 'Decision log',
    file: 'private/decision-log.md',
    icon: { type: 'BUILTIN', value: 'flow-chart-hierachy', color: 'blue' },
  },
  {
    key: 'interview-notes',
    title: 'Interview notes',
    file: 'private/interview-notes.md',
    icon: { type: 'BUILTIN', value: 'checklist', color: 'orange' },
  },
  {
    key: 'launch-plan',
    title: 'Launch plan',
    file: 'private/launch-plan.md',
    icon: { type: 'BUILTIN', value: 'space-rocket-earth', color: 'pink' },
  },
  {
    key: 'runbook-draft',
    title: 'Runbook draft',
    file: 'private/runbook-draft.md',
    icon: { type: 'BUILTIN', value: 'alert-bell-notification-2', color: 'red' },
  },
  {
    key: 'reading-list',
    title: 'Reading list',
    file: 'private/reading-list.md',
    icon: { type: 'BUILTIN', value: 'archive-books', color: 'brown' },
  },
  {
    key: 'incident-scratch',
    title: 'Incident scratch notes',
    file: 'private/incident-scratch.md',
    icon: { type: 'BUILTIN', value: 'file-code-check', color: 'red' },
  },
  {
    key: 'travel-plan',
    title: 'Travel plan',
    file: 'private/travel-plan.md',
    icon: { type: 'BUILTIN', value: 'pin-2-maps-navigation', color: 'yellow' },
  },
  {
    key: 'budget-draft',
    title: 'Budget draft',
    file: 'private/budget-draft.md',
    icon: { type: 'BUILTIN', value: 'cash-briefcase', color: 'green' },
  },
];

const FOCUS_BY_TITLE = {
  Founder: 'workspace growth and the next hire',
  'Engineering lead': 'the next release and on-call load',
  'Product manager': 'discovery for the next bet',
  'Product designer': 'the component library and accessibility',
  'Support lead': 'ticket quality and escalation time',
  'Security engineer': 'the access review',
  'People Ops': 'onboarding and the handbook',
  'Data engineer': 'ingest reliability',
  'Support engineer': 'the known-issues queue',
  'Site reliability engineer': 'alert quality',
  'Data analyst': 'the metrics definitions',
  'Solutions engineer': 'the customer handoff',
  'Backend engineer': 'the migration path',
  'Frontend engineer': 'the editor performance pass',
  'Technical writer': 'the help center structure',
  QA: 'the regression suite',
  'Account executive': 'the enterprise pipeline',
  'People Ops partner': 'the onboarding loop',
  'Customer success': 'the renewal risk list',
  Finance: 'the quarterly forecast',
};

function focusFor(user) {
  return FOCUS_BY_TITLE[user.title] || 'the next milestone';
}

/**
 * Two private pages per user. They exercise the pages a person keeps outside a space:
 * long prose, nested lists, tables, checklists, code and timelines, all owned by that
 * user and invisible to everyone else.
 */
function privateDocuments(users, userIdByKey) {
  return users.flatMap((user, userIndex) => {
    const picks = [
      PRIVATE_TEMPLATES[userIndex % PRIVATE_TEMPLATES.length],
      PRIVATE_TEMPLATES[(userIndex + 5) % PRIVATE_TEMPLATES.length],
    ];
    return picks.map((template, slot) => {
      const key = `private/${user.key}/${template.key}`;
      const first = user.name.split(' ')[0];
      const markdown = readMarkdown(template.file, {
        name: user.name,
        first,
        role: user.title,
        focus: focusFor(user),
      });
      return {
        key,
        title: `${template.title} — ${first}`,
        private: true,
        space: null,
        spaceId: null,
        spaceKey: null,
        author: user.key,
        authorId: userIdByKey[user.key],
        file: template.file,
        markdown,
        createdDaysAgo: Math.max(5, user.joinedDaysAgo - 12 - slot * 9 - (userIndex % 5) * 2),
        updatedDaysAgo: 1 + ((userIndex + slot * 3) % 8),
        trashDaysAgo: null,
        publicLink: false,
        workspaceAccess: null,
        sharing: [],
        comments: [],
        attachments: [],
        icon: template.icon,
      };
    });
  });
}

/**
 * Two extra private pages, each shared with the colleagues who would actually need it.
 *
 * Private pages normally demonstrate isolation; these two demonstrate the other half
 * of the sidebar: every user must have something in Shared, including a workspace with
 * no other explicit grants. The product/GTM page and the engineering/data page are
 * authored by different people; each author is a recipient of the other, and together
 * their recipients cover every profile while neither page is workspace-wide.
 */
const SHARED_PRIVATE_PAGES = [
  {
    key: 'private/shared/project-brief',
    owner: 'alice',
    template: 'project-brief',
    level: 'EDIT',
    createdDaysAgo: 19,
    updatedDaysAgo: 3,
    recipients: ['daniel', 'mei', 'jonas', 'aisha', 'hana', 'elena', 'clara', 'diego', 'zoe'],
  },
  {
    key: 'private/shared/research-notes',
    owner: 'daniel',
    template: 'research-notes',
    level: 'COMMENT',
    createdDaysAgo: 13,
    updatedDaysAgo: 2,
    recipients: [
      'alice',
      'tomas',
      'samir',
      'lucia',
      'kenji',
      'noah',
      'ines',
      'omar',
      'felix',
      'ravi',
      'yuki',
    ],
  },
];

function sharedPrivateDocuments(users, userIdByKey) {
  const knownUsers = new Set(scenario.users.map((user) => user.key));
  return SHARED_PRIVATE_PAGES.map((spec) => {
    const owner = users.find((user) => user.key === spec.owner);
    const template = PRIVATE_TEMPLATES.find((candidate) => candidate.key === spec.template);
    if (!owner || !template) {
      throw new Error(`Shared private fixture ${spec.key} has an unknown owner or template`);
    }
    if (!spec.recipients.every((key) => knownUsers.has(key) && key !== spec.owner)) {
      throw new Error(`Shared private fixture ${spec.key} has an unknown recipient or its owner`);
    }

    const recipients = spec.recipients
      .map((key) => users.find((user) => user.key === key))
      .filter(Boolean);
    const first = owner.name.split(' ')[0];
    const markdown = readMarkdown(template.file, {
      name: owner.name,
      first,
      role: owner.title,
      focus: focusFor(owner),
    });

    return {
      key: spec.key,
      title: `${template.title} — ${first}`,
      private: true,
      sharedPrivate: true,
      space: null,
      spaceId: null,
      spaceKey: null,
      author: owner.key,
      authorId: userIdByKey[owner.key],
      file: template.file,
      markdown,
      createdDaysAgo: spec.createdDaysAgo,
      updatedDaysAgo: spec.updatedDaysAgo,
      trashDaysAgo: null,
      publicLink: false,
      workspaceAccess: null,
      sharing: recipients.map((user) => ({
        user: user.key,
        userId: userIdByKey[user.key],
        level: spec.level,
      })),
      comments: [],
      attachments: [],
      icon: template.icon,
    };
  });
}

const LARGE_ICONS = {
  'generated/feature-brief.md': {
    type: 'BUILTIN',
    value: 'target-center-monitor',
    color: 'purple',
  },
  'generated/runbook.md': { type: 'BUILTIN', value: 'alert-bell-notification-2', color: 'orange' },
  'generated/decision-record.md': {
    type: 'BUILTIN',
    value: 'flow-chart-hierachy',
    color: 'blue',
  },
  'generated/data-catalog.md': { type: 'BUILTIN', value: 'database-1', color: 'green' },
};

function largeDocuments(profile, userByKey) {
  if (profile !== 'large') return [];
  return Array.from({ length: LARGE_DOCUMENT_COUNT }, (_, index) => {
    const group = LARGE_GROUPS[index % LARGE_GROUPS.length];
    const parent = scenario.documents.find((document) => document.key === group.parent);
    const topic = LARGE_TOPICS[Math.floor(index / LARGE_GROUPS.length)];
    const metric = `${topic.toLowerCase()} success rate`;
    const slug = topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const createdDaysAgo = parent.createdDaysAgo - 1 - (index % 20);

    return {
      key: `large/${group.key}-${String(index + 1).padStart(3, '0')}`,
      title: `${group.label}: ${topic}`,
      space: group.space,
      parent: group.parent,
      author: group.author,
      file: LARGE_FORMATS[index % LARGE_FORMATS.length],
      markdownVariables: {
        title: `${group.label}: ${topic}`,
        topic,
        topic_slug: slug,
        owner: userByKey[group.author].name,
        status: ['Proposed', 'In review', 'Ready for trial'][index % 3],
        review_date: 'the next quarterly review',
        quote: `Reliable ${topic.toLowerCase()} starts with a clear owner and a safe recovery path.`,
        summary: `Teams need a predictable way to manage ${topic.toLowerCase()} across workspaces.`,
        metric,
        metric_slug: metric.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        service: `${group.key.replace(/-/g, '_')}_service`,
        region: ['us-east-1', 'eu-west-1', 'ap-southeast-1'][index % 3],
        reference_url: 'https://docs.acme.test/support/playbook',
      },
      createdDaysAgo,
      updatedDaysAgo: Math.min(createdDaysAgo, 1 + (index % 30)),
      profiles: ['large'],
      icon: LARGE_ICONS[LARGE_FORMATS[index % LARGE_FORMATS.length]],
      comments: [],
    };
  });
}

function spaceMembers(spaces, userIdByKey) {
  return spaces.map((space) => ({
    ...space,
    id: seedId('space', space.key),
    members: space.members
      .filter((member) => userIdByKey[member.user])
      .map((member) => ({ userId: userIdByKey[member.user], level: member.level })),
  }));
}

/**
 * The fixture's comment authors and reactors must be able to read the document. A space
 * member with COMMENT+ already can; everybody else gets an explicit page grant, which
 * is what a colleague following a link would ask for in the real product.
 */
function ensureCommentAccess(document, space, spaceMembers, userIdByKey, userByKey) {
  const existing = new Set(document.sharing.map((share) => share.user));
  const spaceLevel = (key) => {
    const userId = userIdByKey[key];
    const membership = spaceMembers.find((member) => member.userId === userId);
    if (membership && ['COMMENT', 'EDIT', 'OWNER'].includes(membership.level)) return true;
    if (space.accessMode === 'PUBLIC' && ['COMMENT', 'EDIT'].includes(space.everyoneAccessLevel)) {
      return true;
    }
    return false;
  };

  const participants = new Set();
  for (const thread of document.comments) {
    participants.add(thread.author);
    for (const reply of thread.replies || []) participants.add(reply.author);
    for (const reaction of thread.reactions || []) participants.add(reaction.author);
  }

  for (const participant of participants) {
    if (participant === document.author) continue;
    if (existing.has(participant)) continue;
    if (spaceLevel(participant)) continue;
    if (!userByKey[participant]) continue;
    document.sharing.push({
      user: participant,
      userId: userIdByKey[participant],
      level: 'COMMENT',
    });
    existing.add(participant);
  }
}

function isImageAttachment(attachment) {
  return attachment.contentType.startsWith('image/');
}

/**
 * An image is the one attachment Markdown can express as a block. Everything else
 * becomes a `file` block below: the stored path is not a route the API serves, so a link
 * to it would be dead, while a file block is resolved through the editor's signed-URL
 * hook like a real upload.
 */
function attachmentMarkdown(attachment) {
  const alt = attachment.fileName.replace(/"/g, '');
  return `![${alt}](${attachment.storedPath})`;
}

/**
 * `comment_reactions` is unique on `(comment_id, user_id, emoji)`, and every reaction of
 * a fixture thread lands on that thread's first comment before `reassignAuthorship`
 * replaces the reacting session with the fixture author. Two same-emoji reactions on one
 * thread therefore have to name different authors, or the reassignment transaction
 * aborts after the whole seed has already been created.
 */
function assertReactionAuthorsDistinct(documents) {
  for (const doc of documents) {
    for (const thread of doc.comments) {
      const seen = new Set();
      for (const reaction of thread.reactions || []) {
        const key = `${reaction.author}\u0000${reaction.emoji}`;
        if (seen.has(key)) {
          throw new Error(
            `Fixture ${doc.key} thread ${thread.index} has two ${reaction.emoji} reactions by ` +
              `${reaction.author}; reassigning authorship would collide on ` +
              '(comment, user, emoji).'
          );
        }
        seen.add(key);
      }
    }
  }
}

function buildPlan(profile) {
  const users = scenario.users.filter((user) => !user.profiles || user.profiles.includes(profile));
  const userIdByKey = Object.fromEntries(users.map((user) => [user.key, seedId('user', user.key)]));
  const userByKey = Object.fromEntries(users.map((user) => [user.key, user]));

  const spaceSource = scenario.spaces.filter(
    (space) => !space.profiles || space.profiles.includes(profile)
  );
  const spaces = spaceMembers(spaceSource, userIdByKey);
  const spaceByKey = Object.fromEntries(spaces.map((space) => [space.key, space]));

  const baseDocs = scenario.documents.filter(
    (document) => !document.profiles || document.profiles.includes(profile)
  );
  const allDocs = [...baseDocs, ...largeDocuments(profile, userByKey)];
  const docIndexByKey = new Map(allDocs.map((document, index) => [document.key, index]));

  const documents = [];
  for (let index = 0; index < allDocs.length; index += 1) {
    const base = allDocs[index];
    const space = spaceByKey[base.space];
    if (!space) throw new Error(`Fixture ${base.key} references unknown space ${base.space}`);
    if (base.parent) {
      const parentIndex = docIndexByKey.get(base.parent);
      if (parentIndex === undefined || parentIndex >= index) {
        throw new Error(`Fixture ${base.key} must appear after its parent ${base.parent}`);
      }
      const parent = allDocs[parentIndex];
      if (parent.space !== base.space) {
        throw new Error(`Fixture ${base.key} and its parent ${base.parent} must share a space`);
      }
    }

    let markdown = readMarkdown(base.file, base.markdownVariables);
    const doc = {
      key: base.key,
      title: base.title,
      icon: base.icon || null,
      spaceId: space.id,
      spaceKey: space.key,
      parentKey: base.parent || null,
      parentId: base.parent ? seedId('doc', base.parent) : null,
      author: base.author,
      authorId: userIdByKey[base.author],
      file: base.file,
      markdown,
      createdDaysAgo: base.createdDaysAgo,
      updatedDaysAgo: base.updatedDaysAgo,
      trashDaysAgo: base.trashDaysAgo ?? null,
      publicLink: Boolean(base.publicLink),
      workspaceAccess: base.workspaceAccess || null,
      sharing: (base.sharing || [])
        .filter((share) => userByKey[share.user])
        .map((share) => ({
          userId: userIdByKey[share.user],
          user: share.user,
          level: share.level,
        })),
      comments: (base.comments || [])
        .filter((thread) => profile !== 'small' || thread.small)
        .map((thread, index) => ({ ...thread, index })),
      attachments: [],
    };

    const documentId = seedId('doc', base.key);
    const attachmentSpecs = scenario.attachments.filter(
      (attachment) => attachment.document === base.key
    );
    for (const spec of attachmentSpecs) {
      const attachmentId = seedId('attachment', spec.key);
      doc.attachments.push({
        ...spec,
        id: attachmentId,
        documentKey: doc.key,
        documentId,
        storageKey: `${documentId}/${attachmentId}`,
        storedPath: `/api/v1/attachments/${attachmentId}`,
      });
    }

    // Attachments are appended as blocks so the source Markdown stays prose-only.
    for (const attachment of doc.attachments) {
      if (isImageAttachment(attachment)) {
        markdown += `\n\n${attachmentMarkdown(attachment)}\n`;
      }
    }
    doc.markdown = markdown;
    doc.fileBlocks = doc.attachments
      .filter((attachment) => !isImageAttachment(attachment))
      .map((attachment) => ({
        type: 'file',
        props: { url: attachment.storedPath, name: attachment.fileName },
      }));

    ensureCommentAccess(doc, space, space.members, userIdByKey, userByKey);
    documents.push(doc);
  }
  documents.push(
    ...privateDocuments(users, userIdByKey),
    ...sharedPrivateDocuments(users, userIdByKey)
  );
  assertReactionAuthorsDistinct(documents);

  const attachments = documents.flatMap((doc) => doc.attachments);

  const invites = scenario.invites.map((invite) => ({
    ...invite,
    id: seedId('invite', invite.key),
  }));

  const workspace = { ...scenario.workspace, id: seedId('workspace', scenario.workspace.key) };

  const plan = {
    profile,
    workspace,
    users: users.map((user) => ({ ...user, id: userIdByKey[user.key] })),
    spaces,
    documents: documents.map((doc) => ({ ...doc, id: seedId('doc', doc.key) })),
    attachments,
    invites,
    contentDir: CONTENT_DIR,
  };
  plan.expectations = expectationsOf(plan);
  return plan;
}

function expectationsOf(plan) {
  const trashed = plan.documents.filter((doc) => doc.trashDaysAgo != null).length;
  const threads = plan.documents.reduce((sum, doc) => sum + doc.comments.length, 0);
  const comments = plan.documents.reduce(
    (sum, doc) =>
      sum + doc.comments.reduce((inner, thread) => inner + 1 + (thread.replies?.length || 0), 0),
    0
  );
  const reactions = plan.documents.reduce(
    (sum, doc) =>
      sum + doc.comments.reduce((inner, thread) => inner + (thread.reactions?.length || 0), 0),
    0
  );
  return {
    users: plan.users.length,
    spaces: plan.spaces.length,
    documents: plan.documents.length,
    trashed,
    archivedSpaces: plan.spaces.filter((space) => space.archivedDaysAgo != null).length,
    threads,
    comments,
    reactions,
    attachments: plan.attachments.length,
    invites: plan.invites.length,
  };
}

module.exports = { buildPlan, assertReactionAuthorsDistinct, expectationsOf, CONTENT_DIR };
