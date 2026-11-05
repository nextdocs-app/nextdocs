import { getCollaboratorRowOptions } from '@/components/share/CollaboratorRow';
import type { Collaborator } from '@/services/document.service';

function createCollaborator(overrides: Partial<Collaborator> = {}): Collaborator {
  return {
    userId: 'user-1',
    email: 'user1@example.com',
    displayName: 'User One',
    accessLevel: 'VIEW',
    addedAt: '2026-01-01T00:00:00Z',
    owner: false,
    ...overrides,
  };
}

describe('getCollaboratorRowOptions', () => {
  it('offers standard roles, NO_ACCESS, and REMOVE for direct non-owner collaborator', () => {
    const collab = createCollaborator();
    const options = getCollaboratorRowOptions(collab);

    const values = options.map((o) => o.value);
    expect(values).toEqual(['OWNER', 'EDIT', 'COMMENT', 'VIEW', 'NO_ACCESS', 'REMOVE']);
  });

  it('omits REMOVE for owners', () => {
    const collab = createCollaborator({ owner: true, accessLevel: 'OWNER' });
    const options = getCollaboratorRowOptions(collab);

    const values = options.map((o) => o.value);
    expect(values).not.toContain('REMOVE');
  });

  it('offers INHERIT and omits REMOVE when overriding an ancestor grant with a title', () => {
    const collab = createCollaborator({
      inherited: false,
      inheritedFromId: 'parent-1',
      inheritedFromTitle: 'Roadmap',
      inheritedAccessLevel: 'EDIT',
    });
    const options = getCollaboratorRowOptions(collab);

    const inheritOption = options.find((o) => o.value === 'INHERIT');
    expect(inheritOption).toBeDefined();
    expect(inheritOption?.label).toBe('Inherit from Roadmap (can edit)');
    expect(options.map((o) => o.value)).not.toContain('REMOVE');
  });

  it('offers INHERIT with fallback title when overriding an untitled ancestor page', () => {
    const collab = createCollaborator({
      inherited: false,
      inheritedFromId: 'parent-1',
      inheritedFromTitle: '   ',
      inheritedAccessLevel: 'VIEW',
    });
    const options = getCollaboratorRowOptions(collab);

    const inheritOption = options.find((o) => o.value === 'INHERIT');
    expect(inheritOption).toBeDefined();
    expect(inheritOption?.label).toBe('Inherit from parent page (can view)');
    expect(options.map((o) => o.value)).not.toContain('REMOVE');
  });

  it('omits both INHERIT and REMOVE for an inherited collaborator row', () => {
    const collab = createCollaborator({
      inherited: true,
      inheritedFromId: 'parent-1',
      inheritedFromTitle: 'Roadmap',
    });
    const options = getCollaboratorRowOptions(collab);

    const values = options.map((o) => o.value);
    expect(values).not.toContain('INHERIT');
    expect(values).not.toContain('REMOVE');
  });
});
