'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeading } from '@/components/SectionHeading';
import { Close, Search } from '@/icons';
import { useAuth } from '@/hooks/useAuth.hook';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';
import { useSearchResults } from '@/hooks/useSearchResults.hook';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '@/lib/offline-navigation.util';
import {
  buildLocalSearchHits,
  getRecentDocumentIds,
  recordRecentDocumentVisit,
} from '@/lib/search-helpers.util';
import { documentService } from '@/services/document.service';
import { MAX_SEARCH_QUERY_LENGTH } from '@/services/search.service';
import { combineSharedDocuments } from '@/stores/documentList/documentList.utils';
import type {
  LocalDocumentEntry,
  SharedDocumentEntry,
} from '@/stores/documentList/documentList.types';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { setMobileNavOpen } from '@/stores/sidebar/sidebar.slice';
import type { SpaceSummary, SpaceTree } from '@/stores/spaceTree/spaceTree.slice';
import { closeSearchDialog } from '@/stores/ui/ui.slice';
import type { SearchBreadcrumb, SearchHit, SearchSpace } from '@/types/search.types';
import type { SidebarTreeNode } from '@/types/tree.types';
import { SearchResultItem } from './SearchResultItem';

/** Path for a local hit whose ancestors were never loaded into the trees. */
interface ResolvedPath {
  breadcrumb: SearchBreadcrumb[];
  space: SearchSpace | null;
}

const LIVE_ANNOUNCE_DELAY_MS = 220;

const EMPTY_DOCS: LocalDocumentEntry[] = [];
const EMPTY_SHARED_DOCS: SharedDocumentEntry[] = [];
const EMPTY_NODES: Record<string, SidebarTreeNode> = {};
const EMPTY_SPACE_TREES: Record<string, SpaceTree> = {};
const EMPTY_SPACES: Record<string, SpaceSummary> = {};

export function SearchDialog() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();
  const { user, isAuthenticated, accessToken } = useAuth();

  const documents = useAppSelector((state) => state.documentList?.documents ?? EMPTY_DOCS);
  const localAllDocs = useAppSelector((state) => state.documentList?.localAllDocs ?? EMPTY_DOCS);
  const sharedWithMeDocuments = useAppSelector(
    (state) => state.documentList?.sharedWithMeDocuments ?? EMPTY_SHARED_DOCS
  );
  const ownerSharedDocuments = useAppSelector(
    (state) => state.documentList?.ownerSharedDocuments ?? EMPTY_SHARED_DOCS
  );
  const trashedDocuments = useAppSelector(
    (state) => state.documentList?.trashedDocuments ?? EMPTY_DOCS
  );
  const sidebarNodes = useAppSelector((state) => state.sidebarTree?.nodes ?? EMPTY_NODES);
  const sharedNodes = useAppSelector((state) => state.sharedTree?.nodes ?? EMPTY_NODES);
  const spaceTrees = useAppSelector((state) => state.spaceTree?.trees ?? EMPTY_SPACE_TREES);
  const spaces = useAppSelector((state) => state.spaceTree?.spaces ?? EMPTY_SPACES);

  const sharedDocuments = useMemo(
    () => combineSharedDocuments(sharedWithMeDocuments, ownerSharedDocuments),
    [sharedWithMeDocuments, ownerSharedDocuments]
  );

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [resolvedPaths, setResolvedPaths] = useState<Record<string, ResolvedPath>>({});

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const loadMoreSentinelRef = useRef<HTMLLIElement>(null);
  const requestedPathIds = useRef(new Set<string>());

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;

  const trimmedQuery = query.trim();
  const recentIds = useMemo(() => getRecentDocumentIds(user?.id ?? null), [user?.id]);

  const {
    hits,
    hasMore,
    isLoading,
    isLoadingMore,
    loadMoreError,
    errorMessage,
    fallbackNotice,
    mode,
    loadMore,
    retry,
  } = useSearchResults({ query, accessToken, isAuthenticated, isOnline });

  // "Private" is a claim about where a document lives, so it needs positive
  // proof. Absence of a space and breadcrumb is not proof: a document shared
  // with the caller has no readable ancestors (the API stops the walk at the
  // first denied one), and one shared from someone else's tree has no space
  // either. Only the caller's own root documents — the listing behind the
  // Private section — qualify.
  const privateRootIds = useMemo(
    () => new Set(documents.filter((doc) => doc.parentId == null).map((doc) => doc.id)),
    [documents]
  );

  const sharedDocumentIds = useMemo(
    () => new Set(sharedDocuments.map((doc) => doc.id)),
    [sharedDocuments]
  );

  // Only the recent/offline/guest views render local hits. A signed-in search does not, so
  // building them there would be a workspace-sized walk on every keystroke.
  const needsLocalHits = !trimmedQuery || mode !== 'search';
  const localHits = useMemo(() => {
    if (!needsLocalHits) {
      return [];
    }
    // The listing pages `documents`, while `localAllDocs` keeps the whole cached set for a
    // degraded listing. Offline title search must see every cached page, not just the
    // first one; shared rows stay out because they arrive through `sharedDocuments`.
    const localDocuments =
      mode === 'offline' && localAllDocs.length > 0
        ? localAllDocs.filter((doc) => !sharedDocumentIds.has(doc.id))
        : documents;
    return buildLocalSearchHits({
      documents: localDocuments,
      sharedDocuments,
      trashedDocuments,
      sidebarNodes,
      sharedNodes,
      spaceTrees,
      spaces,
      recentIds,
      query: trimmedQuery,
      limit: trimmedQuery ? 20 : 8,
    });
  }, [
    needsLocalHits,
    mode,
    documents,
    localAllDocs,
    sharedDocumentIds,
    sharedDocuments,
    trashedDocuments,
    sidebarNodes,
    sharedNodes,
    spaceTrees,
    spaces,
    recentIds,
    trimmedQuery,
  ]);

  const displayedHits = useMemo(() => {
    if (trimmedQuery && mode !== 'offline' && mode !== 'guest') {
      return hits;
    }
    return localHits.map((hit) => {
      const resolved = resolvedPaths[hit.documentId];
      return resolved ? { ...hit, breadcrumb: resolved.breadcrumb, space: resolved.space } : hit;
    });
  }, [trimmedQuery, mode, localHits, hits, resolvedPaths]);

  // Local hits only know the ancestors already loaded into the trees, so a
  // document opened from search — or one whose branch was never expanded —
  // renders without a path until the server resolves it. Results from /search
  // arrive with the chain already; recent documents get the same lookup, once
  // per document, and only when they have no path to show yet.
  useEffect(() => {
    if (!accessToken || !isOnline || mode === 'search') {
      return;
    }

    const unresolved = localHits.filter(
      (hit) =>
        !hit.space &&
        hit.breadcrumb.length === 0 &&
        !privateRootIds.has(hit.documentId) &&
        !requestedPathIds.current.has(hit.documentId)
    );

    for (const hit of unresolved) {
      requestedPathIds.current.add(hit.documentId);
      void documentService
        .getDocumentBreadcrumbs(hit.documentId, accessToken)
        .then((crumbs) => {
          const ancestors = crumbs.filter((crumb) => crumb.id !== hit.documentId);
          const space = crumbs.find((crumb) => crumb.space)?.space ?? null;
          if (ancestors.length === 0 && !space) {
            return;
          }
          setResolvedPaths((current) => ({
            ...current,
            [hit.documentId]: {
              breadcrumb: ancestors.map((crumb) => ({
                id: crumb.id,
                title: crumb.title || 'Untitled',
              })),
              space: space ? { id: space.id, name: space.name } : null,
            },
          }));
        })
        .catch(() => {
          // The path is additive: leave the row as it is rather than fail the list.
          // The id stays claimed so a failing lookup is not retried on every render.
        });
    }
  }, [localHits, accessToken, isOnline, mode, privateRootIds]);

  const clampedActiveIndex =
    displayedHits.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), displayedHits.length - 1);

  const isListboxVisible = !errorMessage && displayedHits.length > 0;
  const activeOptionId =
    isListboxVisible && clampedActiveIndex >= 0
      ? `${baseId}-option-${clampedActiveIndex}`
      : undefined;

  const handleClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog && dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dispatch(closeSearchDialog());
    }
  }, [dispatch]);

  // Open the native modal dialog on mount and wire light-dismiss fallback for
  // browsers without `closedby` (e.g. Safari).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
    inputRef.current?.focus();

    const handleNativeClose = () => {
      dispatch(closeSearchDialog());
    };
    dialog.addEventListener('close', handleNativeClose);

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (event: PointerEvent) => {
        const rect = dialog.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      const handlePointerDown = (event: PointerEvent) => {
        pressedOutside = isOutside(event);
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (pressedOutside && isOutside(event)) {
          if (typeof dialog.close === 'function') {
            dialog.close();
          } else {
            handleNativeClose();
          }
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('pointerup', handlePointerUp);

      return () => {
        dialog.removeEventListener('close', handleNativeClose);
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('pointerup', handlePointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleNativeClose);
    };
  }, [dispatch]);

  // Infinite scroll when scrolled near the bottom of paginated results.
  useEffect(() => {
    if (!hasMore || isLoading || isLoadingMore || loadMoreError || mode !== 'search') {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const root = listRef.current?.parentElement ?? null;
    const target = loadMoreSentinelRef.current;
    if (!root || !target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root, rootMargin: '100px', threshold: 0.1 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, loadMoreError, mode, loadMore]);

  // Keep the highlighted keyboard option visible inside the scroll container.
  useEffect(() => {
    if (!activeOptionId || typeof document === 'undefined') {
      return;
    }
    const element = document.getElementById(activeOptionId);
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  // Debounced live announcement of settled search result counts.
  useEffect(() => {
    if (isLoading || errorMessage || !trimmedQuery) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (displayedHits.length === 0) {
        setLiveAnnouncement(`No results for ${trimmedQuery}`);
      } else if (displayedHits.length === 1) {
        setLiveAnnouncement('1 result found');
      } else {
        setLiveAnnouncement(`${displayedHits.length}${hasMore ? '+' : ''} results found`);
      }
    }, LIVE_ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading, errorMessage, trimmedQuery, displayedHits.length, hasMore]);

  const handleQueryChange = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setActiveIndex(0);
    setLiveAnnouncement('');
  }, []);

  const handleSelectHit = useCallback(
    (hit: SearchHit, openInNewTab: boolean) => {
      recordRecentDocumentVisit(user?.id ?? null, hit.documentId);

      if (openInNewTab) {
        window.open(`/doc/${hit.documentId}`, '_blank', 'noopener,noreferrer');
        return;
      }

      dispatch(setMobileNavOpen(false));
      handleClose();

      if (typeof window !== 'undefined' && navigator.onLine === false) {
        window.dispatchEvent(
          new CustomEvent(OFFLINE_DOCUMENT_SELECT_EVENT, {
            detail: { id: hit.documentId },
          })
        );
        return;
      }

      router.push(`/doc/${hit.documentId}`);
    },
    [user?.id, dispatch, handleClose, router]
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        if (displayedHits.length === 0) {
          return;
        }
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % displayedHits.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        if (displayedHits.length === 0) {
          return;
        }
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + displayedHits.length) % displayedHits.length);
        return;
      }

      if (event.key === 'Enter') {
        // Guard against IME composition confirmation (e.g. CJK input and Safari WebKit 229).
        if (
          event.nativeEvent?.isComposing ||
          event.keyCode === 229 ||
          event.nativeEvent?.keyCode === 229
        ) {
          return;
        }
        const selected = clampedActiveIndex >= 0 ? displayedHits[clampedActiveIndex] : undefined;
        if (!selected) {
          return;
        }
        event.preventDefault();
        handleSelectHit(selected, event.metaKey || event.ctrlKey);
      }
    },
    [displayedHits, clampedActiveIndex, handleSelectHit]
  );

  const sectionHeading = useMemo(() => {
    switch (mode) {
      case 'recent':
        return 'Recent documents';

      case 'offline':
        return 'Matching titles on this device';
      case 'guest':
        return 'Shared documents';
      case 'search':
        return 'Best matches';
    }
  }, [mode]);

  const showSkeleton = isLoading && displayedHits.length === 0 && !errorMessage;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="nd-search-dialog"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <h2 id={titleId} className="sr-only">
        Search documents
      </h2>

      {/* Search input header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-muted-foreground"
        >
          {isLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground/80" />
          ) : (
            <Search size={19} />
          )}
        </span>

        <label htmlFor={inputId} className="sr-only">
          Search documents and content
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={isListboxVisible}
          aria-controls={isListboxVisible ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          value={query}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Search documents and content..."
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          className="min-w-0 flex-1 appearance-none bg-transparent text-[16px] text-foreground placeholder:text-muted-foreground/75 outline-none [&::-webkit-search-cancel-button]:hidden"
        />

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close search"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground transition-colors pointer-coarse:h-9 pointer-coarse:w-9 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Close size={16} />
        </button>
      </div>

      {/* Scrollable results body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
        {(fallbackNotice || (!isOnline && trimmedQuery)) && (
          <div className="mx-3.5 mb-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground">
            {fallbackNotice ?? 'Offline — searching document titles cached on this device.'}
          </div>
        )}

        {errorMessage ? (
          <div className="mx-3.5 my-4 rounded-xl border border-border bg-muted/30 px-4 py-6 text-center">
            <p className="text-[13.5px] font-medium text-foreground">Search failed</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{errorMessage}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : showSkeleton ? (
          <div className="space-y-1.5 px-2.5 py-2" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`search-skeleton-${index}`}
                className="flex items-start gap-3.5 rounded-lg px-3 py-2.5"
              >
                <div className="h-7 w-7 flex-shrink-0 animate-pulse rounded-md bg-muted" />
                <div className="flex-1 space-y-2 py-0.5">
                  <div className="h-3.5 w-2/5 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        ) : displayedHits.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[14.5px] font-medium text-foreground">
              {trimmedQuery ? `No results for “${trimmedQuery}”` : 'No recent documents'}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {trimmedQuery
                ? 'Try different keywords, fewer words, or check your spelling.'
                : 'Documents you open or create will appear here for quick access.'}
            </p>
          </div>
        ) : (
          <div className={isLoading ? 'opacity-70 transition-opacity duration-150' : undefined}>
            <div className="px-5 pb-1.5 pt-0.5">
              <SectionHeading as="span">{sectionHeading}</SectionHeading>
            </div>

            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={sectionHeading}
              className="flex flex-col gap-0.5"
            >
              {displayedHits.map((hit, index) => (
                <SearchResultItem
                  key={hit.documentId}
                  id={`${baseId}-option-${index}`}
                  hit={hit}
                  isActive={index === clampedActiveIndex}
                  showPrivate={isAuthenticated && privateRootIds.has(hit.documentId)}
                  onHover={() => setActiveIndex(index)}
                  onSelect={handleSelectHit}
                />
              ))}

              {hasMore && (
                <li ref={loadMoreSentinelRef} className="px-3.5 pb-1 pt-2 text-center">
                  {loadMoreError && (
                    // A failed next page keeps the rows above it: only the paging control
                    // reports the failure, and its button is the retry.
                    <p role="status" className="mb-1.5 text-[12px] text-muted-foreground">
                      {loadMoreError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={isLoadingMore}
                    onClick={() => void loadMore()}
                    className="inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 cursor-pointer"
                  >
                    {isLoadingMore ? 'Loading more results…' : 'Load more results'}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Screen-reader announcement for settled results */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {trimmedQuery ? liveAnnouncement : ''}
      </div>
    </dialog>
  );
}
