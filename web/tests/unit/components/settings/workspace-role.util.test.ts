import {
  canChangeRole,
  canGrantRole,
  canManageMembers,
  canRemoveMember,
  grantableRoles,
  memberRoleOptions,
  roleOptions,
  workspaceRoleLabel,
} from '../../../../components/settings/workspace/workspace-role.util';

describe('workspace role capabilities', () => {
  it('labels every role', () => {
    expect(workspaceRoleLabel('OWNER')).toBe('Owner');
    expect(workspaceRoleLabel('ADMIN')).toBe('Admin');
    expect(workspaceRoleLabel('MEMBER')).toBe('Member');
  });

  it('lets owners and admins manage membership, but not members', () => {
    expect(canManageMembers('OWNER')).toBe(true);
    expect(canManageMembers('ADMIN')).toBe(true);
    expect(canManageMembers('MEMBER')).toBe(false);
  });

  it('only lets owners grant privileged roles', () => {
    expect(canGrantRole('OWNER', 'OWNER')).toBe(true);
    expect(canGrantRole('OWNER', 'ADMIN')).toBe(true);
    expect(canGrantRole('ADMIN', 'MEMBER')).toBe(true);
    expect(canGrantRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canGrantRole('MEMBER', 'MEMBER')).toBe(false);
  });

  it('never removes yourself, and keeps admins away from privileged members', () => {
    expect(canRemoveMember('OWNER', 'ADMIN', true)).toBe(false);
    expect(canRemoveMember('OWNER', 'ADMIN', false)).toBe(true);
    expect(canRemoveMember('ADMIN', 'MEMBER', false)).toBe(true);
    expect(canRemoveMember('ADMIN', 'ADMIN', false)).toBe(false);
    expect(canRemoveMember('ADMIN', 'OWNER', false)).toBe(false);
    expect(canRemoveMember('MEMBER', 'MEMBER', false)).toBe(false);
  });

  it('only owners change roles, and only a non-last owner may demote themselves', () => {
    expect(canChangeRole('OWNER', { isSelf: false, ownerCount: 1 })).toBe(true);
    expect(canChangeRole('OWNER', { isSelf: true, ownerCount: 2 })).toBe(true);
    expect(canChangeRole('OWNER', { isSelf: true, ownerCount: 1 })).toBe(false);
    expect(canChangeRole('ADMIN', { isSelf: false, ownerCount: 2 })).toBe(false);
  });

  it('offers owners every role and admins only members', () => {
    expect(grantableRoles('OWNER')).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
    expect(grantableRoles('ADMIN')).toEqual(['MEMBER']);
    expect(grantableRoles('MEMBER')).toEqual([]);
    expect(roleOptions('OWNER').map((option) => option.value)).toEqual([
      'OWNER',
      'ADMIN',
      'MEMBER',
    ]);
    expect(roleOptions('ADMIN').map((option) => option.value)).toEqual(['MEMBER']);
    expect(roleOptions('MEMBER')).toEqual([]);
  });

  it('builds member dropdown options with destructive remove when allowed', () => {
    // Owner on another member: can change role and can remove
    const ownerOnMember = memberRoleOptions('OWNER', 'MEMBER', { isSelf: false, ownerCount: 1 });
    expect(ownerOnMember.map((o) => o.value)).toEqual(['OWNER', 'ADMIN', 'MEMBER', 'REMOVE']);
    const removeOpt = ownerOnMember.find((o) => o.value === 'REMOVE');
    expect(removeOpt?.isDestructive).toBe(true);
    expect(removeOpt?.dividerBefore).toBe(true);

    // Owner on themselves with multiple owners: can demote, but cannot remove self
    const ownerOnSelfMulti = memberRoleOptions('OWNER', 'OWNER', { isSelf: true, ownerCount: 2 });
    expect(ownerOnSelfMulti.map((o) => o.value)).toEqual(['OWNER', 'ADMIN', 'MEMBER']);

    // Owner on themselves with single owner: cannot demote, cannot remove
    const ownerOnSelfSingle = memberRoleOptions('OWNER', 'OWNER', { isSelf: true, ownerCount: 1 });
    expect(ownerOnSelfSingle).toEqual([]);

    // Admin on member: cannot change role, but can remove
    const adminOnMember = memberRoleOptions('ADMIN', 'MEMBER', { isSelf: false, ownerCount: 1 });
    expect(adminOnMember.map((o) => o.value)).toEqual(['MEMBER', 'REMOVE']);

    // Admin on owner: cannot change role, cannot remove
    const adminOnOwner = memberRoleOptions('ADMIN', 'OWNER', { isSelf: false, ownerCount: 1 });
    expect(adminOnOwner).toEqual([]);

    // Member on anyone: no actions
    const memberOnMember = memberRoleOptions('MEMBER', 'MEMBER', { isSelf: false, ownerCount: 1 });
    expect(memberOnMember).toEqual([]);
  });
});
