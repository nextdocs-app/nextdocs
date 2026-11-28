import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { UserProfileCard } from '../../../components/profile/UserProfileCard';
import { getAvatarBackground } from '../../../lib/avatar.util';

const user = {
  id: 'user-1',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  avatarUrl: null,
};

function renderCard(overrides: Partial<ComponentProps<typeof UserProfileCard>> = {}) {
  return render(
    <UserProfileCard user={user} {...overrides}>
      <span>avatar</span>
    </UserProfileCard>
  );
}

describe('UserProfileCard', () => {
  it('opens on hover and shows the identity plus an active status', () => {
    renderCard({ isActive: true, presenceColor: '#123456' });

    const trigger = screen.getByRole('button', { name: "View Ada Lovelace's profile" });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.mouseEnter(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
  });

  it('marks the reader and falls back to a generated presence colour', () => {
    const { container } = renderCard({ isActive: true, isCurrentUser: true });

    fireEvent.mouseEnter(screen.getByRole('button', { name: "View Ada Lovelace's profile" }));

    expect(screen.getByText('Ada Lovelace (You)')).toBeInTheDocument();
    const dot = screen.getByText('Active now').querySelector('span');
    expect(dot).toHaveStyle({ backgroundColor: getAvatarBackground('user-1') });
    expect(container).toBeTruthy();
  });

  it('shows when the person last viewed the page', () => {
    const lastViewedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    renderCard({ lastViewedAt });

    fireEvent.mouseEnter(screen.getByRole('button', { name: "View Ada Lovelace's profile" }));

    expect(screen.getByText('Last viewed')).toBeInTheDocument();
    expect(screen.getByText('10 mins ago')).toBeInTheDocument();
  });

  it('shows no status row without presence or view history', () => {
    renderCard();

    fireEvent.mouseEnter(screen.getByRole('button', { name: "View Ada Lovelace's profile" }));

    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Last viewed')).not.toBeInTheDocument();
  });

  it('opens on focus and click', () => {
    renderCard();
    const trigger = screen.getByRole('button', { name: "View Ada Lovelace's profile" });

    trigger.focus();
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseLeave(trigger);
    // A focused card keeps its tooltip while the pointer wanders off.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.blur(trigger, { relatedTarget: document.body });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    fireEvent.blur(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the tooltip while focus moves inside the card', () => {
    renderCard();
    const trigger = screen.getByRole('button', { name: "View Ada Lovelace's profile" });
    const tooltip = screen.getByRole('tooltip');

    fireEvent.focus(trigger);
    fireEvent.blur(trigger, { relatedTarget: tooltip });

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and on mouse leave when unfocused', () => {
    renderCard();
    const trigger = screen.getByRole('button', { name: "View Ada Lovelace's profile" });

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.mouseEnter(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseLeave(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
