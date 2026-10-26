import { act, render, screen, within } from '@testing-library/react';
import { DocumentsPanel } from '../../../components/sidebar/DocumentsPanel';
import type { SidebarSectionDocument } from '../../../components/sidebar/types';

const docs = (n: number): SidebarSectionDocument[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `doc-${i + 1}`,
    parentId: null,
    meta: { title: `Doc ${i + 1}`, icon: undefined },
  })) as unknown as SidebarSectionDocument[];

function renderTrashPanel(
  overrides: {
    searchQuery?: string;
    isSearching?: boolean;
    onLoadMore?: jest.Mock;
  } = {}
) {
  const onLoadMore = overrides.onLoadMore ?? jest.fn(async () => {});
  render(
    <DocumentsPanel
      mode="trash"
      searchQuery={overrides.searchQuery ?? ''}
      setSearchQuery={jest.fn()}
      onClose={jest.fn()}
      isLoadingInitial={false}
      filteredDocuments={docs(3)}
      treeApi={null}
      visibleRootIds={[]}
      visibleIds={null}
      isSearching={overrides.isSearching ?? false}
      onCreateChild={jest.fn()}
      rootHasMore={false}
      isLoadingRootMore={false}
      onLoadMoreRoots={jest.fn()}
      activeDocId=""
      isAuthenticated={false}
      accessToken={null}
      trashActionLoadingDocId={null}
      isPermanentDeleteLoading={false}
      onSelectDocument={jest.fn()}
      onRestoreFromTrash={jest.fn()}
      onRequestPermanentDelete={jest.fn()}
      docActionsAnchor={null}
      onToggleDocumentActions={jest.fn()}
      resolvePanelActionType={() => 'trash' as never}
      resolvePanelTreeActionType={() => 'trash' as never}
      setDocActionsAnchor={jest.fn()}
      hasMore
      isLoadingMore={false}
      onLoadMore={onLoadMore}
    />
  );
  return { onLoadMore };
}

describe('DocumentsPanel trash infinite scroll', () => {
  let OriginalIO: typeof window.IntersectionObserver;

  beforeEach(() => {
    OriginalIO = window.IntersectionObserver;
  });

  afterEach(() => {
    if (OriginalIO === undefined) {
      delete (window as unknown as Record<string, unknown>).IntersectionObserver;
    } else {
      window.IntersectionObserver = OriginalIO;
    }
  });

  it('loads the next page when the sentinel intersects while browsing', () => {
    let capturedCb: IntersectionObserverCallback | null = null;
    window.IntersectionObserver = jest
      .fn()
      .mockImplementation((cb: IntersectionObserverCallback) => {
        capturedCb = cb;
        return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
      }) as unknown as typeof IntersectionObserver;

    const { onLoadMore } = renderTrashPanel();

    expect(capturedCb).not.toBeNull();

    act(() => {
      capturedCb!([{ isIntersecting: true } as IntersectionObserverEntry], null as never);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not observe or load while a search is active', () => {
    const constructorSpy = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
      unobserve: jest.fn(),
    }));
    window.IntersectionObserver = constructorSpy as unknown as typeof IntersectionObserver;

    const { onLoadMore } = renderTrashPanel({ searchQuery: 'xyz', isSearching: true });

    // The effect bails before constructing an observer, so no load can fire
    // while the filtered view cannot grow from new server pages.
    expect(constructorSpy).not.toHaveBeenCalled();
    expect(onLoadMore).not.toHaveBeenCalled();
    // The filtered rows still render under the active search.
    expect(
      within(screen.getByRole('dialog', { name: 'Trash documents' })).getByText('Doc 1')
    ).toBeInTheDocument();
  });
});
