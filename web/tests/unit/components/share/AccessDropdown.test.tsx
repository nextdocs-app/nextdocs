import { render, screen, fireEvent } from '@testing-library/react';
import { AccessDropdown } from '@/components/share/AccessDropdown';
import { getCollaboratorRowOptions } from '@/components/share/CollaboratorRow';
import { normalizeTitle } from '@/components/share/shareOptions';
import type { Collaborator } from '@/services/document.service';

const baseCollab: Collaborator = {
  userId: 'u-1',
  email: 'a@example.com',
  displayName: 'A',
  accessLevel: 'VIEW',
  addedAt: '2024-01-01T00:00:00.000Z',
  owner: false,
  inherited: false,
  inheritedFromId: null,
  inheritedFromTitle: null,
  inheritedAccessLevel: null,
};

describe('AccessDropdown', () => {
  it('opens, selects an option, and closes', () => {
    const onChange = jest.fn();
    render(
      <AccessDropdown
        value="VIEW"
        options={[
          { value: 'VIEW', label: 'Can view' },
          { value: 'EDIT', label: 'Can edit' },
        ]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Can view' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'Can edit' }));
    expect(onChange).toHaveBeenCalledWith('EDIT');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on outside mousedown', () => {
    render(
      <AccessDropdown
        value="VIEW"
        options={[{ value: 'VIEW', label: 'Can view' }]}
        onChange={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Can view' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('marks Escape as handled so an outer panel handler stays shut', () => {
    const outerClosed = jest.fn();
    const outerOnKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) outerClosed();
    };
    // Bubble phase like SharePanel's onEsc (registered first, runs last).
    document.addEventListener('keydown', outerOnKey);

    try {
      render(
        <AccessDropdown
          value="VIEW"
          options={[
            { value: 'VIEW', label: 'Can view' },
            { value: 'EDIT', label: 'Can edit' },
          ]}
          onChange={() => {}}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Can view' }));
      const menu = screen.getByRole('listbox');
      expect(menu).toBeInTheDocument();

      // Target inside the menu (not document itself): at-target dispatch
      // would run same-node listeners in registration order, hiding the
      // capture-before-bubble layering the fix relies on.
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(outerClosed).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', outerOnKey);
    }
  });
});

describe('getCollaboratorRowOptions', () => {
  it('offers Inherit without a divider and separates No access', () => {
    const options = getCollaboratorRowOptions({
      ...baseCollab,
      inherited: false,
      inheritedFromId: 'p-1',
      inheritedFromTitle: '  Parent   Wiki ',
      inheritedAccessLevel: 'EDIT',
    });

    const inherit = options.find((o) => o.value === 'INHERIT');
    const noAccess = options.find((o) => o.value === 'NO_ACCESS');
    expect(inherit?.label).toBe('Inherit from Parent Wiki (can edit)');
    expect(inherit?.dividerBefore).toBe(false);
    expect(noAccess?.dividerBefore).toBe(true);
    expect(noAccess?.isDestructive).toBe(true);
  });

  it('separates No access for inherited and direct rows', () => {
    expect(
      getCollaboratorRowOptions({ ...baseCollab, inherited: true }).find(
        (o) => o.value === 'NO_ACCESS'
      )?.dividerBefore
    ).toBe(true);
    expect(
      getCollaboratorRowOptions(baseCollab).find((o) => o.value === 'NO_ACCESS')?.dividerBefore
    ).toBe(true);
  });

  it('normalizes titles to single spaces', () => {
    expect(normalizeTitle('  Parent   Wiki ')).toBe('Parent Wiki');
  });
});
