'use strict';

const { dateDaysAgo, addDays } = require('../lib/time');
const { sqlString, sqlDate, sha256Hex, runSql } = require('../lib/sql');
const scenario = require('../fixtures/scenario');

/**
 * Identity rows have no safe public creation path once the first account exists:
 * registration is invite-only and requires a mailbox. The seed therefore writes users,
 * the workspace, memberships, spaces and space grants with SQL before the first login.
 * Every write a *user* would perform (pages, sharing, comments, invites) still goes
 * through the product API.
 *
 * Timestamps are final at insert time; the timeline pass re-applies them in one
 * transaction so the whole dataset can be reasoned about together.
 */
function buildIdentitySql(plan) {
  const statements = ['BEGIN;'];

  statements.push(`
INSERT INTO workspaces (id, name, icon_type, icon_value, icon_color, created_at, updated_at)
VALUES (${sqlString(plan.workspace.id)}, ${sqlString(plan.workspace.name)},
        ${sqlString(plan.workspace.icon.type)}, ${sqlString(plan.workspace.icon.value)},
        ${sqlString(plan.workspace.icon.color)},
        ${sqlDate(dateDaysAgo(plan.workspace.createdDaysAgo, 'workspace:created'))},
        ${sqlDate(dateDaysAgo(plan.workspace.createdDaysAgo, 'workspace:created'))});`);

  const userValues = plan.users.map((user) => {
    const joined = dateDaysAgo(user.joinedDaysAgo, `user:${user.key}`);
    return `(${[
      sqlString(user.id),
      sqlString(user.email),
      sqlString(user.name),
      sqlString(scenario.PASSWORD_HASH),
      'TRUE',
      'TRUE',
      sqlDate(joined),
      sqlDate(joined),
    ].join(', ')})`;
  });
  statements.push(`
INSERT INTO users (id, email, display_name, password_hash, email_verified, is_active, created_at, updated_at)
VALUES
  ${userValues.join(',\n  ')};`);

  const owner = plan.users.find((user) => user.key === 'alice');
  const memberValues = plan.users.map((user) => {
    const joined = dateDaysAgo(user.joinedDaysAgo, `user:${user.key}`);
    return `(${[
      sqlString(plan.workspace.id),
      sqlString(user.id),
      sqlString(user.role),
      sqlDate(joined),
    ].join(', ')})`;
  });
  statements.push(`
INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
VALUES
  ${memberValues.join(',\n  ')};`);

  const spaceValues = plan.spaces.map((space) => {
    const created = dateDaysAgo(space.createdDaysAgo, `space:${space.key}`);
    // Archive is applied through the API at the end of the seed. Inserting the space
    // already archived would refuse every page create with a 409.
    return `(${[
      sqlString(space.id),
      sqlString(plan.workspace.id),
      sqlString(space.name),
      sqlString(space.icon.type),
      sqlString(space.icon.value),
      sqlString(space.icon.color),
      sqlString(space.accessMode),
      sqlString(space.everyoneAccessLevel),
      sqlDate(created),
      sqlDate(created),
      'NULL',
      'NULL',
    ].join(', ')})`;
  });
  statements.push(`
INSERT INTO spaces (id, workspace_id, name, icon_type, icon_value, icon_color,
                    access_mode, everyone_access_level, created_at, updated_at,
                    archived_at, archived_by_user_id)
VALUES
  ${spaceValues.join(',\n  ')};`);

  const memberRows = [];
  for (const space of plan.spaces) {
    for (const member of space.members) {
      const granted = dateDaysAgo(
        space.createdDaysAgo,
        `space:${space.key}:member:${member.userId}`
      );
      memberRows.push(
        `(${[
          sqlString(space.id),
          sqlString(member.userId),
          sqlString(member.level),
          sqlString(owner.id),
          sqlDate(granted),
          sqlDate(granted),
        ].join(', ')})`
      );
    }
  }
  if (memberRows.length > 0) {
    statements.push(`
INSERT INTO space_members (space_id, user_id, access_level, granted_by_user_id, created_at, updated_at)
VALUES
  ${memberRows.join(',\n  ')};`);
  }

  // Pending invites are issued through the API so the delivered email exists in Mailpit.
  // Expired and accepted rows are historical states the API cannot create on demand.
  const historicalInvites = plan.invites.filter((invite) => invite.state !== 'pending');
  if (historicalInvites.length > 0) {
    const inviteValues = historicalInvites.map((invite) => {
      const created = dateDaysAgo(invite.createdDaysAgo, `invite:${invite.key}`);
      const expires =
        invite.state === 'accepted'
          ? addDays(created, 7)
          : dateDaysAgo(-invite.expiresInDays, `invite:${invite.key}:expires`);
      const accepted =
        invite.state === 'accepted'
          ? { at: addDays(created, 1), by: owner.id }
          : { at: null, by: null };
      return `(${[
        sqlString(invite.id),
        sqlString(plan.workspace.id),
        sqlString(invite.email),
        sqlString(invite.role),
        sqlString(sha256Hex(`seed-invite-token:${invite.key}`)),
        sqlString(owner.id),
        sqlDate(expires),
        sqlDate(accepted.at),
        sqlString(accepted.by),
        sqlDate(created),
      ].join(', ')})`;
    });
    statements.push(`
INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, created_by,
                               expires_at, accepted_at, accepted_by, created_at)
VALUES
  ${inviteValues.join(',\n  ')};`);
  }

  statements.push('COMMIT;');
  return statements.join('\n');
}

function insertIdentity(plan) {
  runSql(buildIdentitySql(plan));
}

module.exports = { buildIdentitySql, insertIdentity };
