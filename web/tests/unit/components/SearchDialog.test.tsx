import {
  act,
  fireEvent,
  render as baseRender,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { useRouter } from 'next/navigation';
import { SearchDialog } from '../../../components/search/SearchDialog';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';
import { ApiError } from '../../../services/api-client';
import { documentService } from '../../../services/document.service';
import { searchService } from '../../../services/search.service';
import authReducer from '../../../stores/auth/auth.slice';
import documentListReducer from '../../../stores/documentList/documentList.slice';
import sharedTreeReducer from '../../../stores/sharedTree/sharedTree.slice';
import sidebarReducer from '../../../stores/sidebar/sidebar.slice';
import sidebarTreeReducer from '../../../stores/sidebarTree/sidebarTree.slice';
import spaceTreeReducer from '../../../stores/spaceTree/spaceTree.slice';
import uiReducer from '../../../stores/ui/ui.slice';
import type {
  LocalDocumentEntry,
  SharedDocumentEntry,
} from '../../../stores/documentList/documentList.types';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));
jest.mock('../../../hooks/useNetworkStatus.hook', () => ({
  useNetworkStatus: jest.fn(),
}));
jest.mock('../../../services/search.service', () => ({
  MAX_SEARCH_QUERY_LENGTH: 200,
  DEFAULT_SEARCH_LIMIT: 20,
  searchService: {
    search: jest.fn(),
  },
}));

const mockPush = jest.fn();

function createTestStore(
  preloadedDocuments: LocalDocumentEntry[] = [
    {
      id: 'recent-1',
      meta: {
        title: 'Quarterly Planning',
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-10T10:00:00Z',
      },
    },
    {
      id: 'recent-2',
      meta: {
        title: 'Design System',
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-09T10:00:00Z',
      },
    },
  ],
  preloadedSharedDocuments: SharedDocumentEntry[] = []
) {
  const docListInit = documentListReducer(undefined, { type: '@@init' });
  const uiInit = uiReducer(undefined, { type: '@@init' });
  return configureStore({
    reducer: {
      auth: authReducer,
      documentList: documentListReducer,
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      spaceTree: spaceTreeReducer,
      ui: uiReducer,
    },
    preloadedState: {
      ui: {
        ...uiInit,
        isSearchDialogOpen: true,
      },
      documentList: {
        ...docListInit,
        documents: preloadedDocuments,
        sharedWithMeDocuments: preloadedSharedDocuments,
      },
    },
  });
}

function renderDialog(store = createTestStore()) {
  const renderTree = () => (
    <Provider store={store}>
      <SearchDialog />
    </Provider>
  );
  const utils = baseRender(renderTree());
  return { ...utils, store, rerenderDialog: () => utils.rerender(renderTree()) };
}

describe('SearchDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1', displayName: 'Alice', email: 'alice@example.com' },
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: true });
    jest.spyOn(documentService, 'getDocumentBreadcrumbs').mockResolvedValue([]);

    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
  });

  it('shows recent documents when the query is empty and navigates on click', async () => {
    const user = userEvent.setup();
    const { store } = renderDialog();

    expect(screen.getByText('Recent documents')).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Recent documents' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Quarterly Planning/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Design System/i })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /Quarterly Planning/i }));

    expect(mockPush).toHaveBeenCalledWith('/doc/recent-1');
    expect(store.getState().ui.isSearchDialogOpen).toBe(false);
  });

  it('searches from the first character and retains title and body highlights', async () => {
    const user = userEvent.setup();
    (searchService.search as jest.Mock).mockResolvedValue({
      query: 'a',
      hasMore: false,
      nextOffset: 1,
      items: [
        {
          documentId: 'hit-search',
          title: [
            { text: 'Project ', match: false },
            { text: 'Alpha', match: true },
          ],
          snippet: [
            { text: 'Launch ', match: false },
            { text: 'alpha', match: true },
            { text: ' checklist', match: false },
          ],
          breadcrumb: [{ id: 'parent-1', title: 'Initiatives' }],
          space: { id: 'space-1', name: 'Product' },
          icon: { type: 'emoji', value: '📄' },
          updatedAt: '2026-10-12T10:00:00Z',
        },
      ],
    });

    renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });

    await user.type(input, 'a');

    await waitFor(() => {
      expect(searchService.search).toHaveBeenCalledWith('token-1', 'a', {
        limit: 20,
        offset: 0,
        signal: expect.any(AbortSignal),
      });
    });
    // No minimum-length gate: the first character is already a real query.
    expect(searchService.search).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Best matches')).toBeInTheDocument();
    expect(await screen.findByRole('listbox', { name: 'Best matches' })).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Initiatives')).toBeInTheDocument();
    const marks = document.querySelectorAll('mark.nd-search-mark');
    expect(Array.from(marks).map((el) => el.textContent)).toEqual(['Alpha', 'alpha']);
  });

  it('resolves the path of recent documents whose ancestors are not loaded', async () => {
    jest.spyOn(documentService, 'getDocumentBreadcrumbs').mockResolvedValue([
      { id: 'parent-1', title: 'Team Notes' },
      { id: 'nested-1', title: 'Nested Doc' },
    ]);
    const store = createTestStore([
      {
        id: 'nested-1',
        parentId: 'parent-1',
        meta: {
          title: 'Nested Doc',
          createdAt: '2026-10-01T10:00:00Z',
          updatedAt: '2026-10-10T10:00:00Z',
        },
      },
    ]);
    renderDialog(store);

    expect(await screen.findByText('Team Notes')).toBeInTheDocument();
    const option = screen.getByRole('option', { name: /Nested Doc/i });
    expect(within(option).queryByText('Private')).not.toBeInTheDocument();
  });

  it('marks only the caller’s own private roots as Private', () => {
    const store = createTestStore(undefined, [
      {
        id: 'shared-1',
        relationship: 'collaborator',
        parentId: 'unreadable-parent',
        meta: {
          title: 'Shared Page',
          createdAt: '2026-10-01T10:00:00Z',
          updatedAt: '2026-10-11T10:00:00Z',
        },
      },
    ]);
    renderDialog(store);

    const sharedOption = screen.getByRole('option', { name: /Shared Page/i });
    expect(within(sharedOption).queryByText('Private')).not.toBeInTheDocument();

    const privateOption = screen.getByRole('option', { name: /Quarterly Planning/i });
    expect(within(privateOption).getByText('Private')).toBeInTheDocument();
  });

  it('stops loading when remote search becomes unavailable mid-query', async () => {
    const user = userEvent.setup();
    (searchService.search as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { rerenderDialog } = renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });

    await user.type(input, 'kk');

    // Connectivity drops after the request was scheduled: no response will ever
    // arrive, so the skeletons have to give way to the local fallback.
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: false });
    rerenderDialog();

    expect(await screen.findByText('No results for “kk”')).toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });

  it('fails a search that never settles instead of loading forever', async () => {
    jest.useFakeTimers();
    try {
      (searchService.search as jest.Mock).mockImplementation(
        (_token: string, _query: string, options: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      );
      renderDialog();
      const input = screen.getByRole('combobox', { name: /Search documents and content/i });
      fireEvent.change(input, { target: { value: 'kk' } });

      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });

      expect(screen.getByText('Search failed')).toBeInTheDocument();
      expect(screen.getByText(/taking too long/i)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('supports keyboard ArrowDown/ArrowUp/Enter navigation and guards IME Enter', async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });

    // IME composition Enter must not navigate
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(mockPush).not.toHaveBeenCalled();

    // Move selection to second recent item and open it
    await user.keyboard('{ArrowDown}{Enter}');
    expect(mockPush).toHaveBeenCalledWith('/doc/recent-2');
  });

  it.each(['a', 'sync'])('loads additional paginated results for "%s"', async (query) => {
    const user = userEvent.setup();
    (searchService.search as jest.Mock)
      .mockResolvedValueOnce({
        query,
        hasMore: true,
        nextOffset: 1,
        items: [
          {
            documentId: 'hit-1',
            title: [{ text: 'Sync One', match: true }],
            snippet: [],
            breadcrumb: [],
            space: null,
            icon: null,
            updatedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        query,
        hasMore: false,
        nextOffset: 2,
        items: [
          {
            documentId: 'hit-2',
            title: [{ text: 'Sync Two', match: true }],
            snippet: [],
            breadcrumb: [],
            space: null,
            icon: null,
            updatedAt: null,
          },
        ],
      });

    renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });
    await user.type(input, query);

    const loadMoreBtn = await screen.findByRole('button', { name: /Load more results/i });
    await user.click(loadMoreBtn);

    await waitFor(() => {
      expect(searchService.search).toHaveBeenCalledWith('token-1', query, {
        limit: 20,
        offset: 1,
        signal: expect.any(AbortSignal),
      });
    });
    expect(await screen.findByText('Sync Two')).toBeInTheDocument();
  });

  it('keeps the loaded page when loading the next one fails', async () => {
    const user = userEvent.setup();
    (searchService.search as jest.Mock)
      .mockResolvedValueOnce({
        query: 'sync',
        hasMore: true,
        nextOffset: 1,
        items: [
          {
            documentId: 'hit-1',
            title: [{ text: 'Sync One', match: true }],
            snippet: [],
            breadcrumb: [],
            space: null,
            icon: null,
            updatedAt: null,
          },
        ],
      })
      .mockRejectedValueOnce(new ApiError('Gateway Timeout', 504));

    renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });
    await user.type(input, 'sync');
    await user.click(await screen.findByRole('button', { name: /Load more results/i }));

    // A failed next page is a paging error, not a failed search: the rows the user already
    // has stay on screen, and the paging button remains the retry.
    expect(await screen.findByText('Gateway Timeout')).toBeInTheDocument();
    expect(screen.getByText('Sync One')).toBeInTheDocument();
    expect(screen.queryByText('Search failed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load more results/i })).toBeEnabled();
  });

  it('falls back to local title matches when server search is disabled (404) or offline', async () => {
    const user = userEvent.setup();
    (searchService.search as jest.Mock).mockRejectedValue(new ApiError('Not Found', 404));

    renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });
    await user.type(input, 'Planning');

    expect(
      await screen.findByText(/Full-text search is unavailable — showing matching titles/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Quarterly Planning/i })).toBeInTheDocument();
  });

  it('shows retry UI on unexpected API errors and closes cleanly via Close button', async () => {
    const user = userEvent.setup();
    (searchService.search as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Internal Server Error', 500))
      .mockResolvedValueOnce({
        query: 'err',
        hasMore: false,
        nextOffset: 0,
        items: [],
      });

    const { store } = renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });
    await user.type(input, 'err');

    expect(await screen.findByText('Search failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => {
      expect(searchService.search).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/No results for “err”/i)).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Close search/i }));
    });
    expect(store.getState().ui.isSearchDialogOpen).toBe(false);
  });

  it('keeps the newest results when an older request settles last', async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    (searchService.search as jest.Mock).mockReturnValueOnce(firstResponse).mockResolvedValueOnce({
      query: 'ab',
      hasMore: false,
      nextOffset: 1,
      items: [
        {
          documentId: 'hit-new',
          title: [{ text: 'Newer result', match: false }],
          snippet: [],
          breadcrumb: [],
          space: null,
          icon: null,
          updatedAt: null,
        },
      ],
    });

    renderDialog();
    const input = screen.getByRole('combobox', { name: /Search documents and content/i });

    await user.type(input, 'a');
    await waitFor(() => expect(searchService.search).toHaveBeenCalledTimes(1));
    await user.type(input, 'b');
    await waitFor(() => expect(searchService.search).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Newer result')).toBeInTheDocument();

    // The first query answers only now. Whatever settles last must not decide
    // what the list shows: the second query owns the results.
    await act(async () => {
      resolveFirst({
        query: 'a',
        hasMore: false,
        nextOffset: 1,
        items: [
          {
            documentId: 'hit-old',
            title: [{ text: 'Stale result', match: false }],
            snippet: [],
            breadcrumb: [],
            space: null,
            icon: null,
            updatedAt: null,
          },
        ],
      });
    });

    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
    expect(screen.getByText('Newer result')).toBeInTheDocument();
  });
});
