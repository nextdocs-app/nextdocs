import { fireEvent, render, screen } from '@testing-library/react';
import { ViewerStack } from '../../../components/ViewerStack';
import type { DocumentViewer } from '../../../hooks/useDocumentViewers.hook';

function viewer(index: number, overrides: Partial<DocumentViewer> = {}): DocumentViewer {
  return {
    userId: `user-${index}`,
    displayName: `User ${index}`,
    avatarUrl: null,
    lastViewedAt: '2026-01-01T00:00:00Z',
    isActive: false,
    isCurrentUser: false,
    presenceColor: '#c44f4f',
    ...overrides,
  };
}

describe('ViewerStack', () => {
  it('keeps `max - 1` avatars and folds the tail into the overflow menu', () => {
    render(<ViewerStack viewers={[1, 2, 3, 4, 5].map((index) => viewer(index))} max={4} />);

    expect(screen.getAllByRole('button', { name: /'s profile$/ })).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: '2 more people who accessed this document' })
    ).toBeInTheDocument();
    // The folded people are the same tail AvatarGroup hides.
    expect(screen.getByText('User 4')).toBeInTheDocument();
    expect(screen.getByText('User 5')).toBeInTheDocument();
    expect(screen.getByText('User 3')).toBeInTheDocument();
  });

  it('keeps five readers visible before folding anyone into the chip', () => {
    render(<ViewerStack viewers={[1, 2, 3, 4, 5].map((index) => viewer(index))} />);

    expect(screen.getAllByRole('button', { name: /'s profile$/ })).toHaveLength(5);
    expect(
      screen.queryByRole('button', { name: /more people who accessed/ })
    ).not.toBeInTheDocument();
  });

  it('folds the sixth reader into the overflow slot', () => {
    render(<ViewerStack viewers={[1, 2, 3, 4, 5, 6].map((index) => viewer(index))} />);

    expect(screen.getAllByRole('button', { name: /'s profile$/ })).toHaveLength(4);
    expect(
      screen.getByRole('button', { name: '2 more people who accessed this document' })
    ).toBeInTheDocument();
  });

  it('sizes the toolbar avatars like the other icon controls', () => {
    render(<ViewerStack viewers={[1, 2].map((index) => viewer(index))} max={4} />);

    for (const avatarButton of screen.getAllByRole('button', { name: /'s profile$/ })) {
      const avatar = avatarButton.querySelector('svg, img');
      expect(avatar).toHaveStyle({ width: '24px', height: '24px' });
    }
  });

  it('renders every avatar when there is no overflow', () => {
    render(<ViewerStack viewers={[1, 2].map((index) => viewer(index))} max={4} />);

    expect(screen.getAllByRole('button', { name: /'s profile$/ })).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: /more people who accessed/ })
    ).not.toBeInTheDocument();
  });

  it('opens the folded people on hover and closes when the pointer leaves', () => {
    render(<ViewerStack viewers={[1, 2, 3, 4, 5].map((index) => viewer(index))} max={4} />);
    const overflow = screen.getByRole('button', {
      name: '2 more people who accessed this document',
    });

    expect(overflow).toHaveAttribute('aria-expanded', 'false');

    fireEvent.mouseEnter(overflow.parentElement as HTMLElement);

    expect(overflow).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('User 4')).toBeInTheDocument();

    fireEvent.mouseLeave(overflow.parentElement as HTMLElement);

    expect(overflow).toHaveAttribute('aria-expanded', 'false');
  });

  it('pins the popover open on click until it is clicked again or dismissed', () => {
    render(<ViewerStack viewers={[1, 2, 3, 4, 5].map((index) => viewer(index))} max={4} />);
    const overflow = screen.getByRole('button', {
      name: '2 more people who accessed this document',
    });

    fireEvent.click(overflow);
    fireEvent.mouseLeave(overflow.parentElement as HTMLElement);
    // Pinned: leaving the wrapper must not drop a keyboard-driven popover.
    expect(overflow).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(overflow);
    expect(overflow).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses the pinned popover on an outside press or Escape', () => {
    render(<ViewerStack viewers={[1, 2, 3, 4, 5].map((index) => viewer(index))} max={4} />);
    const overflow = screen.getByRole('button', {
      name: '2 more people who accessed this document',
    });

    fireEvent.click(overflow);
    fireEvent.mouseDown(document.body);
    expect(overflow).toHaveAttribute('aria-expanded', 'false');

    fireEvent.focus(overflow);
    expect(overflow).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(overflow).toHaveAttribute('aria-expanded', 'false');
  });

  it('labels presence and view history for the folded rows', () => {
    render(
      <ViewerStack
        max={2}
        viewers={[
          viewer(1, { lastViewedAt: '2026-01-01T00:00:00Z' }),
          viewer(2, { isActive: true, presenceColor: '#0f0' }),
          viewer(3, { isCurrentUser: true, lastViewedAt: null }),
        ]}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: '2 more people who accessed this document' })
    );

    expect(screen.getByText('User 2')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
    expect(screen.getByText('User 3 (You)')).toBeInTheDocument();
    expect(screen.getByText('Last viewed recently')).toBeInTheDocument();
  });

  it('shows the relative view time for a folded row', () => {
    const lastViewedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    render(<ViewerStack max={2} viewers={[viewer(1), viewer(2), viewer(3, { lastViewedAt })]} />);

    fireEvent.click(
      screen.getByRole('button', { name: '2 more people who accessed this document' })
    );

    expect(screen.getByText('Last viewed 10 mins ago')).toBeInTheDocument();
  });

  it('closes the focus-opened popover when focus leaves the container, unless pinned', () => {
    render(
      <div>
        <ViewerStack viewers={[1, 2, 3, 4, 5].map((index) => viewer(index))} max={4} />
        <button type="button">Outside</button>
      </div>
    );
    const overflow = screen.getByRole('button', {
      name: '2 more people who accessed this document',
    });
    const outside = screen.getByRole('button', { name: 'Outside' });

    fireEvent.focus(overflow);
    expect(overflow).toHaveAttribute('aria-expanded', 'true');

    // Focus moving within the container keeps it open.
    fireEvent.blur(overflow, { relatedTarget: overflow.nextElementSibling });
    expect(overflow).toHaveAttribute('aria-expanded', 'true');

    // Focus moving outside closes it when unpinned.
    fireEvent.blur(overflow, { relatedTarget: outside });
    expect(overflow).toHaveAttribute('aria-expanded', 'false');

    // A pinned popover stays open on blur.
    fireEvent.click(overflow);
    expect(overflow).toHaveAttribute('aria-expanded', 'true');
    fireEvent.blur(overflow, { relatedTarget: outside });
    expect(overflow).toHaveAttribute('aria-expanded', 'true');
  });

  it('constrains the overflow popover within narrow viewports while preserving desktop placement', () => {
    render(<ViewerStack viewers={[1, 2, 3, 4, 5].map((index) => viewer(index))} max={4} />);
    const overflow = screen.getByRole('button', {
      name: '2 more people who accessed this document',
    });
    const tooltipId = overflow.getAttribute('aria-controls');
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null;
    const wrapper = tooltip?.parentElement;

    expect(tooltip).not.toBeNull();
    expect(wrapper).toHaveClass(
      'fixed',
      'inset-x-2',
      'top-11',
      'sm:inset-x-auto',
      'sm:absolute',
      'sm:right-0',
      'sm:top-full'
    );
    expect(tooltip).toHaveClass('w-full', 'max-w-72', 'sm:w-72');
  });
});
