import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { PeopleSection } from '@/components/share/PeopleSection';
import type { PeopleGroup } from '@/components/share/peopleGroups';
import type { Collaborator } from '@/services/document.service';

function person(overrides: Partial<Collaborator> & Pick<Collaborator, 'userId'>): Collaborator {
  return {
    email: `${overrides.userId}@example.com`,
    displayName: overrides.userId,
    accessLevel: 'VIEW',
    addedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('PeopleSection', () => {
  const noop = () => {};

  it('renders document group with custom icon', () => {
    const groups: PeopleGroup[] = [
      {
        key: 'document:doc-1',
        kind: 'document',
        title: 'From “Product roadmap”',
        sourceId: 'doc-1',
        sourceTitle: 'Product roadmap',
        people: [
          person({ userId: 'alice', inherited: true, inheritedFromId: 'doc-1' }),
          person({ userId: 'bob', inherited: true, inheritedFromId: 'doc-1' }),
        ],
      },
    ];

    render(
      <PeopleSection
        pinned={null}
        flat={[]}
        groups={groups}
        breadcrumbs={[
          { id: 'doc-1', title: 'Product roadmap', icon: { type: 'emoji', value: '🗺️' } },
        ]}
        canManageSharing={true}
        hasEffectivePublicLink={false}
        effectiveLinkAction="view"
        recentlyAddedUserIds={new Set()}
        onAccessSelect={noop}
        onNavigate={noop}
      />
    );

    expect(screen.getByText('From “Product roadmap”')).toBeInTheDocument();
    expect(screen.getByText('🗺️')).toBeInTheDocument();
  });

  it('renders document group without custom icon using fallback DocumentText glyph', () => {
    const groups: PeopleGroup[] = [
      {
        key: 'document:doc-2',
        kind: 'document',
        title: 'From “Design docs”',
        sourceId: 'doc-2',
        sourceTitle: 'Design docs',
        people: [
          person({ userId: 'alice', inherited: true, inheritedFromId: 'doc-2' }),
          person({ userId: 'bob', inherited: true, inheritedFromId: 'doc-2' }),
        ],
      },
    ];

    const { container } = render(
      <PeopleSection
        pinned={null}
        flat={[]}
        groups={groups}
        canManageSharing={true}
        hasEffectivePublicLink={false}
        effectiveLinkAction="view"
        recentlyAddedUserIds={new Set()}
        onAccessSelect={noop}
        onNavigate={noop}
      />
    );

    expect(screen.getByText('From “Design docs”')).toBeInTheDocument();
    // DocumentText svg glyph rendered
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('renders space group with custom icon and tile style', () => {
    const groups: PeopleGroup[] = [
      {
        key: 'space:space-1',
        kind: 'space',
        title: 'From “Engineering”',
        sourceId: 'space-1',
        sourceTitle: 'Engineering',
        people: [
          person({ userId: 'alice', inherited: true, inheritedFromId: 'space-1' }),
          person({ userId: 'bob', inherited: true, inheritedFromId: 'space-1' }),
        ],
      },
    ];

    render(
      <PeopleSection
        pinned={null}
        flat={[]}
        groups={groups}
        breadcrumbs={[
          {
            id: 'doc',
            title: 'Doc',
            space: { id: 'space-1', name: 'Engineering', icon: { type: 'emoji', value: '⚙️' } },
          },
        ]}
        canManageSharing={true}
        hasEffectivePublicLink={false}
        effectiveLinkAction="view"
        recentlyAddedUserIds={new Set()}
        onAccessSelect={noop}
        onNavigate={noop}
      />
    );

    expect(screen.getByText('From “Engineering”')).toBeInTheDocument();
    expect(screen.getByText('⚙️')).toBeInTheDocument();
  });

  it('renders space group without custom icon with space placeholder Layers tile', () => {
    const groups: PeopleGroup[] = [
      {
        key: 'space:space-2',
        kind: 'space',
        title: 'From “General”',
        sourceId: 'space-2',
        sourceTitle: 'General',
        people: [
          person({ userId: 'alice', inherited: true, inheritedFromId: 'space-2' }),
          person({ userId: 'bob', inherited: true, inheritedFromId: 'space-2' }),
        ],
      },
    ];

    render(
      <PeopleSection
        pinned={null}
        flat={[]}
        groups={groups}
        canManageSharing={true}
        hasEffectivePublicLink={false}
        effectiveLinkAction="view"
        recentlyAddedUserIds={new Set()}
        onAccessSelect={noop}
        onNavigate={noop}
      />
    );

    expect(screen.getByText('From “General”')).toBeInTheDocument();
    expect(screen.getByTestId('space-placeholder')).toBeInTheDocument();
  });

  it('renders blocked group with lock icon', () => {
    const groups: PeopleGroup[] = [
      {
        key: 'blocked',
        kind: 'blocked',
        title: 'Blocked',
        sourceId: null,
        sourceTitle: null,
        people: [person({ userId: 'malicious', accessLevel: 'NO_ACCESS' })],
      },
    ];

    render(
      <PeopleSection
        pinned={null}
        flat={[]}
        groups={groups}
        canManageSharing={true}
        hasEffectivePublicLink={false}
        effectiveLinkAction="view"
        recentlyAddedUserIds={new Set()}
        onAccessSelect={noop}
        onNavigate={noop}
      />
    );

    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('expands and collapses group children on click', async () => {
    const user = userEvent.setup();
    const groups: PeopleGroup[] = [
      {
        key: 'document:doc-1',
        kind: 'document',
        title: 'From “Product roadmap”',
        sourceId: 'doc-1',
        sourceTitle: 'Product roadmap',
        people: [
          person({ userId: 'alice', inherited: true, inheritedFromId: 'doc-1' }),
          person({ userId: 'bob', inherited: true, inheritedFromId: 'doc-1' }),
        ],
      },
    ];

    render(
      <PeopleSection
        pinned={null}
        flat={[]}
        groups={groups}
        canManageSharing={true}
        hasEffectivePublicLink={false}
        effectiveLinkAction="view"
        recentlyAddedUserIds={new Set()}
        onAccessSelect={noop}
        onNavigate={noop}
      />
    );

    const button = screen.getByRole('button', { name: /From “Product roadmap”/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
  });

  describe('the viewer’s own row', () => {
    function renderSelfRow(overrides: Partial<Collaborator>, canManageSharing = true): void {
      render(
        <PeopleSection
          pinned={person({ userId: 'me', ...overrides })}
          flat={[]}
          groups={[]}
          canManageSharing={canManageSharing}
          currentUserId="me"
          hasEffectivePublicLink={false}
          effectiveLinkAction="view"
          recentlyAddedUserIds={new Set()}
          onAccessSelect={noop}
          onNavigate={noop}
        />
      );
    }

    it('is editable when the viewer holds OWNER', () => {
      renderSelfRow({ accessLevel: 'OWNER' });

      expect(screen.getByRole('button', { name: /Owner/i })).toBeInTheDocument();
    });

    it('is editable when the viewer holds a lower level but can manage sharing', () => {
      // A hierarchy owner who demoted themselves on this child can still
      // administer sharing, so their own row must stay editable.
      renderSelfRow({ accessLevel: 'EDIT' });

      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();
    });

    it('offers Leave to a lower-level viewer who cannot manage sharing', () => {
      // Removing yourself is not a sharing write: the API keeps it on the leave
      // endpoint, so an invited EDIT collaborator can still take themselves off.
      renderSelfRow({ accessLevel: 'EDIT' }, false);

      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();
    });

    it('offers Leave to a viewer who cannot manage sharing', () => {
      renderSelfRow({ accessLevel: 'OWNER' }, false);

      expect(screen.getByRole('button', { name: /Owner/i })).toBeInTheDocument();
    });

    it('is read-only when the membership is inherited', () => {
      // Inherited access cannot be left; the API answers 404, so no menu is offered.
      renderSelfRow({ accessLevel: 'EDIT', inherited: true, inheritedFromId: 'space-1' }, false);

      expect(screen.queryByRole('button', { name: /Can edit/i })).not.toBeInTheDocument();
      expect(screen.getByText('Can edit')).toBeInTheDocument();
    });

    it('is read-only when the viewer has no leave and cannot manage sharing', () => {
      renderSelfRow({ accessLevel: 'NO_ACCESS' }, false);

      expect(screen.queryByRole('button', { name: /No access/i })).not.toBeInTheDocument();
      expect(screen.getByText('No access')).toBeInTheDocument();
    });

    it('is editable for an owner row', () => {
      render(
        <PeopleSection
          pinned={person({ userId: 'me', accessLevel: 'OWNER' })}
          flat={[]}
          groups={[]}
          canManageSharing={true}
          currentUserId="me"
          hasEffectivePublicLink={false}
          effectiveLinkAction="view"
          recentlyAddedUserIds={new Set()}
          onAccessSelect={noop}
          onNavigate={noop}
        />
      );

      expect(screen.getByRole('button', { name: /Owner/i })).toBeInTheDocument();
    });
  });
});
