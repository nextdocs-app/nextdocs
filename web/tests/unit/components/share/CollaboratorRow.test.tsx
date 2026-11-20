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

describe('CollaboratorRow', () => {
  function renderRow(overrides: Partial<Collaborator> = {}, detail?: string) {
    return render(
      <CollaboratorRow
        collab={createCollaborator(overrides)}
        isSelf={false}
        canEditRow={false}
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
