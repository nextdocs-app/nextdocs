import { fireEvent, render, screen } from '@testing-library/react';
import { CommentsSidebar } from '@/components/comments/CommentsSidebar';
import { CommentsSidebarHeader } from '@/components/comments/CommentsSidebarHeader';
import type { CommentThreadStats } from '@/components/comments/CommentsSidebar';

let mockThreads = new Map();
let mockSelectedThreadId: string | undefined = undefined;
const mockGetUser = jest.fn((id: string): { id: string; username: string } | undefined => ({
  id,
  username: `User ${id}`,
}));
const mockLoadUsers = jest.fn(async () => {});

jest.mock('@blocknote/react', () => ({
  useExtension: jest.fn(() => ({
    userStore: {
      store: {
        subscribe: jest.fn(() => () => {}),
      },
      getUser: mockGetUser,
      loadUsers: mockLoadUsers,
    },
  })),
  useExtensionState: jest.fn(() => mockSelectedThreadId),
  useThreads: jest.fn(() => mockThreads),
  ThreadsSidebar: ({ filter }: { filter: string }) => (
    <div data-testid="threads-sidebar" data-filter={filter}>
      Threads Sidebar Content
    </div>
  ),
}));

describe('CommentsSidebarHeader', () => {
  const defaultStats: CommentThreadStats = { open: 2, resolved: 1, all: 3 };

  it('renders title and filter counts', () => {
    render(
      <CommentsSidebarHeader
        filter="open"
        sort="position"
        stats={defaultStats}
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: /comments/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /open/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /resolved/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument();
  });

  it('triggers onFilterChange when clicking filter tabs', () => {
    const onFilterChange = jest.fn();
    render(
      <CommentsSidebarHeader
        filter="open"
        sort="position"
        stats={defaultStats}
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /resolved/i }));
    expect(onFilterChange).toHaveBeenCalledWith('resolved');
  });

  it('triggers onSortChange when changing sort select', () => {
    const onSortChange = jest.fn();
    render(
      <CommentsSidebarHeader
        filter="open"
        sort="position"
        stats={defaultStats}
        onFilterChange={jest.fn()}
        onSortChange={onSortChange}
        onClose={jest.fn()}
      />
    );

    const select = screen.getByLabelText(/sort comment threads/i);
    fireEvent.change(select, { target: { value: 'recent-activity' } });
    expect(onSortChange).toHaveBeenCalledWith('recent-activity');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(
      <CommentsSidebarHeader
        filter="open"
        sort="position"
        stats={defaultStats}
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByLabelText(/close comments sidebar/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CommentsSidebar', () => {
  beforeEach(() => {
    mockThreads.clear();
    mockSelectedThreadId = undefined;
    mockGetUser.mockImplementation((id: string) => ({ id, username: `User ${id}` }));
    mockLoadUsers.mockReset();
    mockLoadUsers.mockImplementation(async () => {});
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <CommentsSidebar
        isOpen={false}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
    expect(document.body.getAttribute('data-comments-sidebar-open')).toBeNull();
  });

  it('sets data-comments-sidebar-open on document.body when open, and cleans up on unmount', () => {
    const { unmount, rerender } = render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(document.body.getAttribute('data-comments-sidebar-open')).toBe('true');

    rerender(
      <CommentsSidebar
        isOpen={false}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(document.body.getAttribute('data-comments-sidebar-open')).toBeNull();

    rerender(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(document.body.getAttribute('data-comments-sidebar-open')).toBe('true');

    unmount();
    expect(document.body.getAttribute('data-comments-sidebar-open')).toBeNull();
  });

  it('renders global empty state when there are no comment threads at all', () => {
    render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('No comment threads yet')).toBeInTheDocument();
    expect(screen.getByText(/highlight text in the editor and click comment/i)).toBeInTheDocument();
  });

  it('renders "All caught up!" empty state when on open filter and all threads are resolved', () => {
    mockThreads.set('t1', { id: 't1', resolved: true, resolvedBy: 'u1', comments: [] });

    render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('All caught up!')).toBeInTheDocument();
    expect(screen.getByText(/no open comment threads on this document/i)).toBeInTheDocument();
  });

  it('renders "No resolved threads" empty state when on resolved filter and no threads are resolved', () => {
    mockThreads.set('t1', { id: 't1', resolved: false, comments: [] });

    render(
      <CommentsSidebar
        isOpen={true}
        filter="resolved"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('No resolved threads')).toBeInTheDocument();
    expect(
      screen.getByText(/threads marked as resolved will be archived here/i)
    ).toBeInTheDocument();
  });

  it('renders ThreadsSidebar when there are threads matching the active filter', () => {
    mockThreads.set('t1', { id: 't1', resolved: false, comments: [] });

    render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId('threads-sidebar')).toBeInTheDocument();
  });

  it('closes when pressing the Escape key', () => {
    const onClose = jest.fn();
    render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when pressing Escape if the event default was prevented', () => {
    const onClose = jest.fn();
    render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={onClose}
      />
    );

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders ThreadsSidebar on open filter even if resolved threads have missing users', () => {
    mockThreads.set('t1', { id: 't1', resolved: false, comments: [] });
    mockThreads.set('t2', { id: 't2', resolved: true, resolvedBy: 'missing-user', comments: [] });
    mockGetUser.mockImplementation((id: string) =>
      id === 'missing-user' ? undefined : { id, username: `User ${id}` }
    );

    render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId('threads-sidebar')).toBeInTheDocument();
  });

  it('renders loading state on resolved filter when resolved threads have missing users', () => {
    mockThreads.set('t1', { id: 't1', resolved: true, resolvedBy: 'missing-user', comments: [] });
    mockGetUser.mockImplementation((id: string) =>
      id === 'missing-user' ? undefined : { id, username: `User ${id}` }
    );

    render(
      <CommentsSidebar
        isOpen={true}
        filter="resolved"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('Loading comments…')).toBeInTheDocument();
  });

  it('auto-expands filter to "all" when a newly selected thread does not match the active filter', () => {
    mockThreads.set('t-resolved', { id: 't-resolved', resolved: true, comments: [] });
    mockSelectedThreadId = 't-resolved';

    const onFilterChange = jest.fn();
    render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(onFilterChange).toHaveBeenCalledWith('all');
  });

  it('does not reset filter to "all" when user changes filter while a thread is already selected', () => {
    mockThreads.set('t-open', { id: 't-open', resolved: false, comments: [] });
    mockSelectedThreadId = 't-open';

    const onFilterChange = jest.fn();
    const { rerender } = render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    onFilterChange.mockClear();

    // User switches tab to 'resolved'
    rerender(
      <CommentsSidebar
        isOpen={true}
        filter="resolved"
        sort="position"
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it('does not reset filter to "all" when resolving an open thread while on open filter', () => {
    const thread = { id: 't1', resolved: false, comments: [] };
    mockThreads.set('t1', thread);
    mockSelectedThreadId = 't1';

    const onFilterChange = jest.fn();
    const { rerender } = render(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    onFilterChange.mockClear();

    // Thread is resolved
    mockThreads.set('t1', { ...thread, resolved: true });
    rerender(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it('handles scrolling to the selected thread without error when scrollTo is undefined', () => {
    const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    mockThreads.set('t1', { id: 't1', resolved: false, comments: [] });
    mockSelectedThreadId = 't1';

    expect(() => {
      render(
        <CommentsSidebar
          isOpen={true}
          filter="open"
          sort="position"
          onFilterChange={jest.fn()}
          onSortChange={jest.fn()}
          onClose={jest.fn()}
        />
      );
    }).not.toThrow();

    rafSpy.mockRestore();
  });

  it('renders ThreadsSidebar when preloading resolved thread users fails', async () => {
    mockThreads.set('t1', { id: 't1', resolved: true, resolvedBy: 'missing-user', comments: [] });
    mockGetUser.mockImplementation((id: string) =>
      id === 'missing-user' ? undefined : { id, username: `User ${id}` }
    );
    mockLoadUsers.mockRejectedValueOnce(new Error('Network failure'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <CommentsSidebar
        isOpen={true}
        filter="resolved"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(await screen.findByTestId('threads-sidebar')).toBeInTheDocument();
    expect(screen.queryByText('Loading comments…')).not.toBeInTheDocument();
    warnSpy.mockRestore();
  });

  it('retries preloading when missing users change after a preload failure', async () => {
    mockThreads.set('t1', { id: 't1', resolved: true, resolvedBy: 'user-1', comments: [] });
    mockGetUser.mockReturnValue(undefined);
    mockLoadUsers.mockRejectedValueOnce(new Error('Network failure'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { rerender } = render(
      <CommentsSidebar
        isOpen={true}
        filter="resolved"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(await screen.findByTestId('threads-sidebar')).toBeInTheDocument();
    expect(mockLoadUsers).toHaveBeenCalledWith(['user-1']);

    mockThreads = new Map(mockThreads);
    mockThreads.set('t2', { id: 't2', resolved: true, resolvedBy: 'user-2', comments: [] });
    mockLoadUsers.mockImplementation(async () => {});

    rerender(
      <CommentsSidebar
        isOpen={true}
        filter="resolved"
        sort="position"
        onFilterChange={jest.fn()}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(mockLoadUsers).toHaveBeenCalledWith(['user-1', 'user-2']);
    warnSpy.mockRestore();
  });

  it('processes selected thread and expands filter when sidebar opens after thread was selected while closed', () => {
    mockThreads.set('t-resolved', { id: 't-resolved', resolved: true, comments: [] });
    mockSelectedThreadId = 't-resolved';

    const onFilterChange = jest.fn();
    const { rerender } = render(
      <CommentsSidebar
        isOpen={false}
        filter="open"
        sort="position"
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(onFilterChange).not.toHaveBeenCalled();

    rerender(
      <CommentsSidebar
        isOpen={true}
        filter="open"
        sort="position"
        onFilterChange={onFilterChange}
        onSortChange={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(onFilterChange).toHaveBeenCalledWith('all');
  });
});
