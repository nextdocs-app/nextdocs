import { render, screen } from '@testing-library/react';
import { CollaboratorRow, getCollaboratorRowOptions } from '@/components/share/CollaboratorRow';
import type { Collaborator } from '@/services/document.service';

function createCollaborator(overrides: Partial<Collaborator> = {}): Collaborator {
  return {
    userId: 'user-1',
    email: 'user1@example.com',
    displayName: 'User One',
    accessLevel: 'VIEW',
    addedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getCollaboratorRowOptions', () => {
  it('offers one revoke entry for a direct non-owner collaborator', () => {
    const collab = createCollaborator();
    const options = getCollaboratorRowOptions(collab);

    // No access is the API's single revoke verb: it writes a DENY only when an
    // inherited channel exists to shadow and deletes the direct grant otherwise,
    // so a separate Remove entry would be the same write under another name.
    expect(options.map((o) => o.value)).toEqual(['OWNER', 'EDIT', 'COMMENT', 'VIEW', 'NO_ACCESS']);
  });

  it('falls back to the raw level label for an unrecognized self grant', () => {
    const options = getCollaboratorRowOptions(
      createCollaborator({ accessLevel: 'CUSTOM' as never }),
      { canManageSharing: false, isSelf: true }
    );

    expect(options[0].label).toBe('CUSTOM');
  });

  it('offers the full ladder and revoke on an owner row', () => {
    // Ownership is a level, so the row is editable exactly like any other grant.
    const collab = createCollaborator({ accessLevel: 'OWNER' });
    expect(getCollaboratorRowOptions(collab).map((o) => o.value)).toEqual([
      'OWNER',
      'EDIT',
      'COMMENT',
      'VIEW',
      'NO_ACCESS',
    ]);
  });

  it('offers INHERIT when overriding an ancestor grant with a title', () => {
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
    expect(options.map((o) => o.value).filter((v) => v === 'NO_ACCESS' || v === 'INHERIT')).toEqual(
      ['INHERIT', 'NO_ACCESS']
    );
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
  });

  it('offers only No access for an inherited collaborator row', () => {
    const collab = createCollaborator({
      inherited: true,
      inheritedFromId: 'parent-1',
      inheritedFromTitle: 'Roadmap',
    });
    const options = getCollaboratorRowOptions(collab);

    const values = options.map((o) => o.value);
    expect(values).toContain('NO_ACCESS');
    expect(values).not.toContain('INHERIT');
    expect(values).not.toContain('LEAVE');
  });

  it("offers no change to a non-admin on somebody else's row", () => {
    expect(getCollaboratorRowOptions(createCollaborator(), { canManageSharing: false })).toEqual(
      []
    );
  });

  it("offers Leave page on an admin's own editable row", () => {
    const options = getCollaboratorRowOptions(createCollaborator({ accessLevel: 'EDIT' }), {
      isSelf: true,
    });

    expect(options.map((o) => o.value)).toEqual(['OWNER', 'EDIT', 'COMMENT', 'VIEW', 'LEAVE']);
  });

  it('offers Leave page to a non-admin on their own row, next to the level they hold', () => {
    const options = getCollaboratorRowOptions(createCollaborator({ accessLevel: 'EDIT' }), {
      isSelf: true,
      canManageSharing: false,
    });

    // Two entries: the trigger keeps a selected label and the menu is not a dead
    // dropdown, which is how spaceMemberOptions handles a member leaving.
    expect(options.map((o) => o.value)).toEqual(['EDIT', 'LEAVE']);
    expect(options[1]).toMatchObject({ label: 'Leave page', isDestructive: true });
  });

  it('offers Leave to a self owner row; the API keeps the last owner', () => {
    const options = getCollaboratorRowOptions(createCollaborator({ accessLevel: 'OWNER' }), {
      isSelf: true,
    });

    expect(options.map((o) => o.value)).toEqual(['OWNER', 'EDIT', 'COMMENT', 'VIEW', 'LEAVE']);
  });

  it('offers no Leave when the membership is inherited', () => {
    const options = getCollaboratorRowOptions(
      createCollaborator({ inherited: true, inheritedFromId: 'space-1' }),
      { isSelf: true }
    );

    // The API answers 404 for an inherited membership, so the row stays read-only.
    expect(options.map((o) => o.value)).not.toContain('LEAVE');
  });

  it('offers no Leave for a self No access row or an archived space', () => {
    const blocked = getCollaboratorRowOptions(createCollaborator({ accessLevel: 'NO_ACCESS' }), {
      isSelf: true,
    });
    expect(blocked.map((o) => o.value)).not.toContain('LEAVE');

    const archived = getCollaboratorRowOptions(createCollaborator({ accessLevel: 'EDIT' }), {
      isSelf: true,
      spaceArchived: true,
    });
    expect(archived.map((o) => o.value)).not.toContain('LEAVE');
  });
});

describe('CollaboratorRow', () => {
  function renderRow(overrides: Partial<Collaborator> = {}, detail?: string) {
    return render(
      <CollaboratorRow
        collab={createCollaborator(overrides)}
        isSelf={false}
        canManageSharing={false}
        detail={detail}
        hasEffectivePublicLink={false}
        effectiveLinkAction="view"
        onAccessSelect={jest.fn()}
      />
    );
  }

  it('draws the uploaded photo when the grantee has one', () => {
    const { container } = renderRow({
      avatarUrl: '/api/v1/users/user-1/avatar?v=abc123',
    });

    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      '/api/v1/users/user-1/avatar?v=abc123'
    );
  });

  it('falls back to initials and the address when there is no display name', () => {
    const { container } = renderRow({ displayName: '' });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('text')).toHaveTextContent('U');
    expect(screen.getAllByText('user1@example.com').length).toBeGreaterThan(0);
  });

  it('renders without an inherited-from badge', () => {
    renderRow();

    // No ancestor to name, so the row is just the person.
    expect(screen.queryByText(/inherited/i)).not.toBeInTheDocument();
    expect(screen.getByText('User One')).toBeInTheDocument();
  });
});
