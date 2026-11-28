import { render, screen } from '@testing-library/react';
import { AvatarGroup, getAvatarGroupCounts } from '../../../components/AvatarGroup';

function avatar(id: string) {
  return <span key={id}>{id}</span>;
}

describe('getAvatarGroupCounts', () => {
  it('shows every avatar when they fit', () => {
    expect(getAvatarGroupCounts(4, 4)).toEqual({ overflow: 0, visibleCount: 4 });
  });

  it('gives the overflow chip one of the slots', () => {
    expect(getAvatarGroupCounts(5, 4)).toEqual({ overflow: 2, visibleCount: 3 });
  });
});

describe('AvatarGroup', () => {
  it('renders the children and no chip when the group fits', () => {
    render(<AvatarGroup ariaLabel="People">{['a', 'b'].map(avatar)}</AvatarGroup>);

    expect(screen.getByRole('group', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('paints a default overflow chip using only the visible slots', () => {
    render(<AvatarGroup max={3}>{['a', 'b', 'c', 'd', 'e'].map(avatar)}</AvatarGroup>);

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.queryByText('c')).not.toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('hands the overflow count to a custom renderer', () => {
    const renderOverflow = jest.fn((overflow: number) => <button>+{overflow}</button>);

    render(
      <AvatarGroup max={2} renderOverflow={renderOverflow}>
        {['a', 'b', 'c'].map(avatar)}
      </AvatarGroup>
    );

    expect(renderOverflow).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: '+2' })).toBeInTheDocument();
  });

  it('keeps a re-sorted group keyed by child identity', () => {
    const { rerender } = render(<AvatarGroup>{['a', 'b', 'c'].map(avatar)}</AvatarGroup>);
    rerender(<AvatarGroup>{['c', 'a', 'b'].map(avatar)}</AvatarGroup>);

    expect(screen.getAllByText(/^[abc]$/).map((node) => node.textContent)).toEqual(['c', 'a', 'b']);
  });

  it('accepts plain text children', () => {
    render(<AvatarGroup>{['a', 'b']}</AvatarGroup>);

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });
});
