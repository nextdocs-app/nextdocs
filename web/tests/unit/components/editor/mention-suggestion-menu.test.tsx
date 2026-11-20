import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import { MentionSuggestionMenu } from '../../../../components/editor/mentions/MentionSuggestionMenu';

// Only the list is ours; the popover chrome comes from the shadcn components, which
// would drag the whole editor package into this unit test.
jest.mock('@blocknote/shadcn', () => ({
  components: {
    SuggestionMenu: {
      Root: ({ children }: { children?: ReactNode }) => <div role="listbox">{children}</div>,
      Label: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      EmptyItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    },
  },
}));

function candidate(displayName: string, email: string): DefaultReactSuggestionItem {
  return {
    title: displayName,
    subtext: email,
    group: 'People',
    icon: <span data-testid={`avatar-${displayName}`} />,
    onItemClick: jest.fn(),
  };
}

describe('MentionSuggestionMenu', () => {
  it('renders a person as a two-line row with their email', () => {
    const onItemClick = jest.fn();
    const alice = candidate('Alice', 'alice@example.com');

    render(
      <MentionSuggestionMenu
        items={[alice, candidate('Bob', 'bob@example.com')]}
        loadingState="loaded"
        selectedIndex={0}
        onItemClick={onItemClick}
      />
    );

    // The group header the stock menu drew must survive the custom row list.
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-Alice')).toBeInTheDocument();

    const [first] = screen.getAllByRole('option');
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(first);
    expect(onItemClick).toHaveBeenCalledWith(alice);
  });

  it('says so when nobody matches', () => {
    render(<MentionSuggestionMenu items={[]} loadingState="loaded" selectedIndex={undefined} />);

    expect(screen.getByText('No people found')).toBeInTheDocument();
  });

  it('holds the empty label while the first page is still loading', () => {
    render(
      <MentionSuggestionMenu items={[]} loadingState="loading-initial" selectedIndex={undefined} />
    );

    expect(screen.queryByText('No people found')).toBeNull();
  });

  it('draws one header per group and skips the email line when an item has none', () => {
    const ungrouped: DefaultReactSuggestionItem = { title: 'Solo', onItemClick: jest.fn() };

    render(
      <MentionSuggestionMenu
        items={[
          candidate('Alice', 'alice@example.com'),
          candidate('Bob', 'bob@example.com'),
          ungrouped,
        ]}
        loadingState="loaded"
        selectedIndex={undefined}
        onItemClick={jest.fn()}
      />
    );

    expect(screen.getAllByText('People')).toHaveLength(1);
    expect(screen.getByText('Solo').closest('[role="option"]')?.querySelector('p')).toBeNull();
  });

  it('keeps focus in the editor on mousedown and tolerates a missing click handler', () => {
    const onItemClick = jest.fn();
    render(
      <MentionSuggestionMenu
        items={[candidate('Alice', 'alice@example.com')]}
        loadingState="loaded"
        selectedIndex={undefined}
        onItemClick={onItemClick}
      />
    );

    const option = screen.getByRole('option');
    // fireEvent reports false when the handler called preventDefault.
    expect(fireEvent.mouseDown(option)).toBe(false);

    fireEvent.click(option);
    expect(onItemClick).toHaveBeenCalledTimes(1);

    render(
      <MentionSuggestionMenu
        items={[candidate('Bob', 'bob@example.com')]}
        loadingState="loaded"
        selectedIndex={undefined}
      />
    );
    fireEvent.click(screen.getAllByRole('option')[1]);
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });
});
