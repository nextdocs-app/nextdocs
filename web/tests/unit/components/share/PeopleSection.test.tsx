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
    owner: false,
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
        icon: { type: 'emoji', value: '🗺️' },
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
        icon: null,
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
        icon: { type: 'emoji', value: '⚙️' },
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
        icon: null,
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
        icon: null,
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
});
