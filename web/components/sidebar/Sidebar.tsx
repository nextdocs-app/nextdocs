'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { memo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useDocumentList } from '@/hooks/useDocumentList.hook';
import { useGuestSharedTree } from '@/hooks/useGuestSharedTree.hook';
import { documentService } from '@/services/document.service';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import {
  selectRootLevelOwnerSharedDocumentIds,
  selectSharedWithMeDocumentIds,
} from '@/stores/documentList/documentList.selectors';
import {
  setCollapsed,
  setMobileNavOpen,
  setPanelMode,
  setSearchQuery,
  togglePrivateOpen,
  toggleSharedOpen,
  setDocActionsAnchor,
} from '@/stores/sidebar/sidebar.slice';
import {
  setAuthModalOpen,
  setSettingsModalOpen,
  setAccountMenuOpen,
  setPermanentDeleteTarget,
} from '@/stores/ui/ui.slice';
import { addToast } from '@/stores/toasts/toasts.slice';

import {
  NewDocument,
  Search,
  ChevronRight,
  NextDocs,
  Close,
  CloseSidebar,
  OpenSidebar,
  UserCircle,
} from '@/icons';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { SettingsModal } from '@/components/SettingsModal';
import { useTheme } from '@/hooks/useTheme.hook';
import { useAuth } from '@/hooks/useAuth.hook';
import { useOfflineDocumentSelect } from '@/hooks/useOfflineDocumentSelect.hook';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { generateDocumentId } from '@/lib/document-id.util';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '@/lib/offline-navigation.util';
import { resolveRootDocumentId } from '@/lib/root-document.util';
import {
  isSidebarDropAllowed,
  resolveSidebarMoveRoute,
  type SidebarDropZone,
} from '@/lib/sidebar-drop-rules';

import {
  fetchRootNodesThunk,
  fetchChildrenThunk,
  removeNode,
  toggleExpanded as privateToggleExpanded,
  moveDocumentThunk as privateMoveDocumentThunk,
  resetTree as resetSidebarTree,
} from '@/stores/sidebarTree/sidebarTree.slice';
import {
  fetchChildrenThunk as fetchSharedChildrenThunk,
  fetchPublicChildrenThunk,
  syncSharedRoots,
  removeNode as sharedRemoveNode,
  toggleExpanded as sharedToggleExpanded,
  moveDocumentThunk as sharedMoveDocumentThunk,
  resetTree as resetSharedTree,
} from '@/stores/sharedTree/sharedTree.slice';

// Import sub-components
import { SharedTree } from './SharedTree';
import { SidebarTree } from './SidebarTree';
import { ProfileMenuPopup } from './ProfileMenuPopup';
import { DocumentActionsMenu } from './DocumentActionsMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { useSidebarResize } from './useSidebarResize';
import {
  SidebarTreeDndContext,
  type MoveDocumentArgs,
  type TreeApi,
} from './SidebarTreeDndContext';

import type { SharedDocumentEntry } from '@/stores/documentList/documentList.types';
import type { DocActionType, SidebarSectionDocument } from './types';

const emptySubscribe = () => () => {};
const SIDEBAR_COLLAPSE_HOVER_GUARD_MS = 260;

// Stable empty list for the guest Shared section (guests have no document
// list); a fresh literal per render would re-run the roots sync effect.
const EMPTY_SHARED_DOCUMENTS: SharedDocumentEntry[] = [];
const guestNoop = () => {};
const guestResolveActionType = () => 'move-to-trash' as const;

function Sidebar() {
  const router = useRouter();
  const params = useParams();
  const routeActiveDocId = (params?.id as string) || '';
  const {
    documents,
    sharedDocuments = [],
    trashedDocuments,
    isSharedLoading = false,
    isSharedLoadingMore = false,
    sharedHasMore = false,
    isShowingAllShared = false,
    isLoadingMore,
    hasMore,
    isShowingAll,
    isTrashLoading,
    isTrashLoadingMore,
    trashHasMore,
    refresh,
    refreshTrash,
    showAllDocuments,
    showAllSharedDocuments = () => {},
    showTrashDocuments,
    loadMore,
    loadMoreSharedDocuments = async () => {},
    loadMoreTrashDocuments,
  } = useDocumentList();
  const { resolvedTheme } = useTheme();
  const { user, isAuthenticated, accessToken, logout, isInitializing } = useAuth();
  const userInitial =
    user?.displayName?.trim()?.charAt(0)?.toUpperCase() ||
    user?.email?.charAt(0)?.toUpperCase() ||
    'U';
  const accountLabel = isInitializing
    ? 'Loading account...'
    : isAuthenticated && user
      ? user.displayName
      : 'Guest User';

  const dispatch = useAppDispatch();
  const isSidebarCollapsed = useAppSelector((state) => state.sidebar.isCollapsed);
  const isMobileNavOpen = useAppSelector((state) => state.sidebar.isMobileNavOpen);
  const isPrivateOpen = useAppSelector((state) => state.sidebar.isPrivateOpen);
  const isSharedOpen = useAppSelector((state) => state.sidebar.isSharedOpen);
  const documentsPanelMode = useAppSelector((state) => state.sidebar.panelMode);
  const docActionsAnchor = useAppSelector((state) => state.sidebar.docActionsAnchor);
  const searchQuery = useAppSelector((state) => state.sidebar.searchQuery);
  const privateTreeNodes = useAppSelector((state) => state.sidebarTree?.nodes ?? {});
  const privateTreeRootIds = useAppSelector((state) => state.sidebarTree?.rootIds ?? []);
  const privateRootHasMore = useAppSelector((state) => state.sidebarTree?.rootHasMore ?? false);
  const privateRootPage = useAppSelector((state) => state.sidebarTree?.rootPage ?? 0);
  const privateRootLoading = useAppSelector((state) => state.sidebarTree?.isRootLoading ?? false);
  const sharedTreeNodes = useAppSelector((state) => state.sharedTree?.nodes ?? {});
  const sharedTreeRootIds = useAppSelector((state) => state.sharedTree?.rootIds ?? []);
  const sharedWithMeDocumentIds = useAppSelector(selectSharedWithMeDocumentIds);
  const rootLevelOwnerSharedDocumentIds = useAppSelector(selectRootLevelOwnerSharedDocumentIds);

  const { sidebarWidth, isResizing, startResizing } = useSidebarResize();

  // Mobile renders the same rail as an off-canvas drawer, which has no collapsed
  // state: it is either covering the page or hidden off-screen.
  const isMobileLayout = useIsMobileLayout();
  const isRailCollapsed = isMobileLayout ? false : isSidebarCollapsed;
  const closeMobileNav = useCallback(() => dispatch(setMobileNavOpen(false)), [dispatch]);

  const [offlineSelectedDocumentId, setOfflineSelectedDocumentId] = useState<string | null>(null);
  const isAccountMenuOpen = useAppSelector((state) => state.ui.isAccountMenuOpen);
  const isSettingsOpen = useAppSelector((state) => state.ui.isSettingsModalOpen);
  const permanentDeleteTarget = useAppSelector((state) => state.ui.permanentDeleteTarget);
  const [trashActionLoadingDocId, setTrashActionLoadingDocId] = useState<string | null>(null);
  const [isPermanentDeleteLoading, setIsPermanentDeleteLoading] = useState(false);
  const [isSidebarCollapseHoverGuard, setIsSidebarCollapseHoverGuard] = useState(false);

  const activeDocId = offlineSelectedDocumentId ?? routeActiveDocId;
  const { isGuestSharedLoading } = useGuestSharedTree(isAuthenticated ? '' : activeDocId);
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuPopupRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const isDocumentsPanelOpen = documentsPanelMode !== null;
  const isTrashPanel = documentsPanelMode === 'trash';
  const isSharedPanel = documentsPanelMode === 'shared';
  const profileMenuStyle = { left: '0.5rem', bottom: '4rem' } as React.CSSProperties;

  const panelDocuments = useMemo(
    () => (isTrashPanel ? trashedDocuments : isSharedPanel ? sharedDocuments : documents),
    [isTrashPanel, isSharedPanel, trashedDocuments, sharedDocuments, documents]
  );

  const panelHasMore = isTrashPanel ? trashHasMore : isSharedPanel ? sharedHasMore : hasMore;
  const panelIsLoadingMore = isTrashPanel
    ? isTrashLoadingMore
    : isSharedPanel
      ? isSharedLoadingMore
      : isLoadingMore;

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return panelDocuments;
    }

    return panelDocuments.filter((doc) =>
      (doc.meta.title || 'Untitled').toLowerCase().includes(query)
    );
  }, [panelDocuments, searchQuery]);

  const panelTreeApi = useMemo<TreeApi | null>(() => {
    if (isTrashPanel) {
      return null;
    }

    if (isSharedPanel) {
      return {
        nodes: sharedTreeNodes,
        rootIds: sharedTreeRootIds,
        toggleExpanded: (id) => dispatch(sharedToggleExpanded(id)),
        fetchChildren: (parentId) => void dispatch(fetchSharedChildrenThunk({ parentId })),
        moveDocument: (args) => void dispatch(sharedMoveDocumentThunk(args)),
        canPlaceAtRoot: (draggedId) => sharedTreeNodes[draggedId]?.parentId == null,
      };
    }

    return {
      nodes: privateTreeNodes,
      rootIds: privateTreeRootIds,
      toggleExpanded: (id) => dispatch(privateToggleExpanded(id)),
      fetchChildren: (parentId) => void dispatch(fetchChildrenThunk({ parentId })),
      moveDocument: (args) => void dispatch(privateMoveDocumentThunk(args)),
      // Mirror sidebarTreeApi: shared nodes may only be placed at root if they
      // are already roots; private nodes are always allowed at root.
      canPlaceAtRoot: (draggedId) =>
        Object.hasOwn(sharedTreeNodes, draggedId)
          ? sharedTreeNodes[draggedId]?.parentId == null
          : true,
    };
  }, [
    isTrashPanel,
    isSharedPanel,
    dispatch,
    sharedTreeNodes,
    sharedTreeRootIds,
    privateTreeNodes,
    privateTreeRootIds,
  ]);

  const isPanelSearching = searchQuery.trim().length > 0;

  const panelIsLoadingInitial = isTrashPanel
    ? isTrashLoading
    : isSharedPanel
      ? isSharedLoading && panelTreeApi?.rootIds.length === 0
      : privateRootLoading && panelTreeApi?.rootIds.length === 0;

  // Documents that live in the Shared section (shared with me, or root-level
  // documents shared by me) must not be listed in the Private section's tree or
  // "show more" panel. Nested documents that were shared stay under their
  // actual parent in the Private tree.
  // Stabilized by content key: documentList refreshes replace the id arrays
  // with new references even when the ids are unchanged; without this the
  // unified DnD context (`sidebarTreeApi`) gets a new identity and re-renders
  // both sections on every background refresh.
  const excludedNodeIdsKey = useMemo(() => {
    const ids = [...sharedWithMeDocumentIds, ...rootLevelOwnerSharedDocumentIds];
    ids.sort();
    return ids.join(',');
  }, [sharedWithMeDocumentIds, rootLevelOwnerSharedDocumentIds]);
  const excludedNodeIds = useMemo(() => {
    const excluded = new Set<string>(sharedWithMeDocumentIds);
    for (const id of rootLevelOwnerSharedDocumentIds) {
      excluded.add(id);
    }
    return excluded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludedNodeIdsKey]);

  const isPrivatePanel = !isTrashPanel && !isSharedPanel;

  /**
   * Cross-tree move router for the unified sidebar DnD context.
   *
   * Moving a document between two shared documents remains blocked in the UI because
   * a move only needs EDIT on the target parent (shared→shared reparenting requires
   * separate move-authorization). Only sibling reordering inside the Shared section
   * is offered. Dropping a private document into a shared document IS allowed: the
   * backend transfers ownership of the moved subtree to the host tree's owner
   * (location authority), and access then flows from the new parent chain.
   */
  const handleSidebarTreeMove = useCallback(
    (args: MoveDocumentArgs) => {
      const draggedIsShared = Object.hasOwn(sharedTreeNodes, args.documentId);
      const targetParentIdIsShared =
        args.newParentId != null && Object.hasOwn(sharedTreeNodes, args.newParentId);

      // Guests hold no identity in someone else's tree and every move endpoint
      // requires a token, so a shared drop could only throw and raise an error
      // toast. Drops inside their own local documents still route below.
      if (!isAuthenticated && (draggedIsShared || targetParentIdIsShared)) {
        return;
      }

      const route = resolveSidebarMoveRoute(args, { draggedIsShared, targetParentIdIsShared });

      if (route.kind === 'shared-reorder') {
        void dispatch(sharedMoveDocumentThunk(args))
          .unwrap()
          .catch((error) => {
            console.error('Failed to reorder shared document:', error);
            dispatch(
              addToast({ message: 'Failed to move document. Please try again.', type: 'error' })
            );
          });
        return;
      }
      if (route.kind === 'private') {
        void dispatch(privateMoveDocumentThunk(args))
          .unwrap()
          .catch((error) => {
            console.error('Failed to move document:', error);
            dispatch(
              addToast({ message: 'Failed to move document. Please try again.', type: 'error' })
            );
          });
        return;
      }
      if (route.kind === 'shared-nest-adopt') {
        void (async () => {
          try {
            const result = await dispatch(sharedMoveDocumentThunk(args));
            if (!sharedMoveDocumentThunk.fulfilled.match(result)) {
              throw new Error('Move request failed');
            }
            // The document left the private tree: drop it from that store and
            // refresh roots so section membership stays accurate.
            dispatch(removeNode(args.documentId));
            await dispatch(fetchRootNodesThunk());
            await refresh(false);
            dispatch(
              addToast({
                message: 'Moved into the shared document. Its access now follows the new location.',
                type: 'info',
              })
            );
          } catch (error) {
            console.error('Failed to move document into shared tree:', error);
            dispatch(
              addToast({ message: 'Failed to move document. Please try again.', type: 'error' })
            );
          }
        })();
        return;
      }

      // Shared→shared moves fall through here; only reorder/private/adopt route above.
      dispatch(
        addToast({
          message: 'Nesting shared documents inside each other is not supported.',
          type: 'info',
        })
      );
    },
    [dispatch, sharedTreeNodes, refresh, isAuthenticated]
  );

  /**
   * Single DnD tree api spanning both sections so drags can cross them. Node ids are
   * UUIDs, so the merged map is collision-free; routing keys off which store holds a node.
   */
  const sidebarTreeApi = useMemo<TreeApi>(() => {
    const mergedNodes = { ...privateTreeNodes, ...sharedTreeNodes };
    const isSharedNode = (id: string) => Object.hasOwn(sharedTreeNodes, id);
    const visiblePrivateRootIds = privateTreeRootIds.filter((id) => !excludedNodeIds.has(id));
    return {
      nodes: mergedNodes,
      rootIds: [...visiblePrivateRootIds, ...sharedTreeRootIds],
      getRootIds: (nodeId: string) =>
        isSharedNode(nodeId) ? sharedTreeRootIds : visiblePrivateRootIds,
      toggleExpanded: (id) =>
        dispatch(isSharedNode(id) ? sharedToggleExpanded(id) : privateToggleExpanded(id)),
      fetchChildren: (parentId) => {
        if (!isSharedNode(parentId)) {
          void dispatch(fetchChildrenThunk({ parentId }));
          return;
        }
        // One shared section, two child sources: guests have no token, so their
        // children come from the anonymous endpoint that resolves the link's
        // effective access instead of the authenticated children endpoint.
        void dispatch(
          isAuthenticated
            ? fetchSharedChildrenThunk({ parentId })
            : fetchPublicChildrenThunk({ parentId })
        );
      },
      canPlaceAtRoot: (draggedId) =>
        isSharedNode(draggedId) ? mergedNodes[draggedId]?.parentId == null : true,
      resolveDrop: (draggedId, { nodeId, zone }) =>
        isSidebarDropAllowed(zone as SidebarDropZone, {
          draggedId,
          draggedIsShared: isSharedNode(draggedId),
          targetIsShared: isSharedNode(nodeId),
          draggedParentId: mergedNodes[draggedId]?.parentId ?? null,
          targetParentId: mergedNodes[nodeId]?.parentId ?? null,
        }),
      moveDocument: handleSidebarTreeMove,
    };
  }, [
    privateTreeNodes,
    sharedTreeNodes,
    privateTreeRootIds,
    sharedTreeRootIds,
    excludedNodeIds,
    dispatch,
    handleSidebarTreeMove,
    isAuthenticated,
  ]);

  // Search-filtered tree: a node is visible when its title matches or when any
  // of its (loaded) descendants matches. Ancestors of matches stay visible.
  const { visibleRootIds, visibleIds } = useMemo(() => {
    if (!panelTreeApi) {
      return { visibleRootIds: [], visibleIds: null };
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return {
        visibleRootIds: isPrivatePanel
          ? panelTreeApi.rootIds.filter((rootId) => !excludedNodeIds.has(rootId))
          : panelTreeApi.rootIds,
        visibleIds: null,
      };
    }

    const { nodes, rootIds } = panelTreeApi;
    const visible = new Set<string>();
    const visit = (id: string): boolean => {
      const node = nodes[id];
      if (!node) {
        return false;
      }
      const selfMatch = (node.title || 'Untitled').toLowerCase().includes(query);
      const hasVisibleChild = node.children.some(visit);
      if (selfMatch || hasVisibleChild) {
        visible.add(id);
        return true;
      }
      return false;
    };
    rootIds.forEach(visit);

    return {
      visibleRootIds: rootIds.filter(
        (id) => visible.has(id) && (!isPrivatePanel || !excludedNodeIds.has(id))
      ),
      visibleIds: visible,
    };
  }, [panelTreeApi, searchQuery, isPrivatePanel, excludedNodeIds]);

  const resolvePanelTreeActionType = useCallback(
    (documentId: string): DocActionType => {
      if (isSharedPanel) {
        const node = sharedTreeNodes[documentId];
        if (node?.parentId != null) {
          return 'move-to-trash';
        }
        return node?.effectiveAccessLevel === 'OWNER' ? 'move-to-trash' : 'leave-shared';
      }
      return 'move-to-trash';
    },
    [isSharedPanel, sharedTreeNodes]
  );

  // Use useSyncExternalStore to safely detect if we are on the client
  // without triggering "cascading render" lint errors or hydration mismatches.
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const handleCreateFile = useCallback(
    async (parentId?: string) => {
      closeMobileNav();
      try {
        const newId = generateDocumentId();
        const created = await documentService.createDocument();
        await documentService.saveDocument(newId, created.ydoc, created.meta);

        if (isAuthenticated && accessToken) {
          await documentService.createCloudDocument(
            accessToken,
            newId,
            created.meta.title || 'Untitled',
            created.ydoc,
            created.meta.createdBy ?? null,
            parentId ?? null
          );
          void dispatch(fetchRootNodesThunk());
          if (parentId) {
            if (sharedTreeNodes[parentId]) {
              void dispatch(fetchSharedChildrenThunk({ parentId }));
            } else {
              void dispatch(fetchChildrenThunk({ parentId }));
            }
          }
        }

        await refresh(false);
        router.push(`/doc/${newId}`);
      } catch (error) {
        console.error('Failed to create document:', error);
        dispatch(
          addToast({ message: 'Failed to create document. Please try again.', type: 'error' })
        );
      }
    },
    [router, refresh, isAuthenticated, accessToken, dispatch, sharedTreeNodes, closeMobileNav]
  );

  const handleSelectDocument = useCallback(
    (id: string) => {
      // Navigating away leaves the drawer covering the page it just opened.
      closeMobileNav();

      if (typeof window !== 'undefined' && navigator.onLine === false) {
        window.dispatchEvent(
          new CustomEvent(OFFLINE_DOCUMENT_SELECT_EVENT, {
            detail: { id },
          })
        );
        return;
      }

      router.push(`/doc/${id}`);
    },
    [router, closeMobileNav]
  );

  const navigateToResolvedRootDocument = useCallback(
    async (options?: {
      excludedDocumentIds?: string[];
      isAuthenticated?: boolean;
      accessToken?: string | null;
    }) => {
      const nextAccessToken =
        options && Object.prototype.hasOwnProperty.call(options, 'accessToken')
          ? (options.accessToken ?? null)
          : accessToken;

      const nextDocumentId = await resolveRootDocumentId({
        isAuthenticated: options?.isAuthenticated ?? isAuthenticated,
        accessToken: nextAccessToken,
        excludedDocumentIds: options?.excludedDocumentIds,
      });

      router.replace(`/doc/${nextDocumentId}`);
    },
    [router, isAuthenticated, accessToken]
  );

  useOfflineDocumentSelect(setOfflineSelectedDocumentId);

  useEffect(() => {
    if (!offlineSelectedDocumentId) {
      return;
    }

    if (routeActiveDocId === offlineSelectedDocumentId) {
      setOfflineSelectedDocumentId(null);
    }
  }, [routeActiveDocId, offlineSelectedDocumentId]);

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const isWithinTrigger = accountMenuTriggerRef.current?.contains(target);
      const isWithinPopup = accountMenuPopupRef.current?.contains(target);
      if (!isWithinTrigger && !isWithinPopup) {
        dispatch(setAccountMenuOpen(false));
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatch(setAccountMenuOpen(false));
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAccountMenuOpen, dispatch]);

  // Escape dismisses the mobile drawer, matching every other overlay in the app.
  useEffect(() => {
    if (!isMobileNavOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobileNav();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMobileNavOpen, closeMobileNav]);

  useEffect(() => {
    if (!isSidebarCollapseHoverGuard) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsSidebarCollapseHoverGuard(false);
    }, SIDEBAR_COLLAPSE_HOVER_GUARD_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSidebarCollapseHoverGuard]);

  const handleLoadMore = useCallback(async () => {
    if (isTrashPanel) {
      await loadMoreTrashDocuments();
    } else if (isSharedPanel) {
      await loadMoreSharedDocuments();
    } else {
      await loadMore();
    }
  }, [isTrashPanel, isSharedPanel, loadMore, loadMoreSharedDocuments, loadMoreTrashDocuments]);

  useEffect(() => {
    if (!docActionsAnchor) {
      return;
    }

    const handleOutsideClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-doc-actions-root='${docActionsAnchor.documentId}']`)) {
        dispatch(setDocActionsAnchor(null));
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatch(setDocActionsAnchor(null));
      }
    };

    const handleScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(`[data-doc-actions-root='${docActionsAnchor.documentId}']`)) {
        return;
      }
      dispatch(setDocActionsAnchor(null));
    };

    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [docActionsAnchor, dispatch]);

  const openAllDocumentsPanel = useCallback(() => {
    if (!isShowingAll) {
      showAllDocuments();
    }
    dispatch(setSearchQuery(''));
    dispatch(setPanelMode('all'));
    // Ensure the private tree is loaded even when the sidebar is collapsed
    // (the sidebar tree only fetches roots while it is rendered).
    if (privateTreeRootIds.length === 0) {
      void dispatch(fetchRootNodesThunk());
    }
  }, [isShowingAll, showAllDocuments, dispatch, privateTreeRootIds.length]);

  const openSharedDocumentsPanel = useCallback(() => {
    if (!isShowingAllShared) {
      showAllSharedDocuments();
    }
    dispatch(syncSharedRoots(sharedDocuments));
    dispatch(setSearchQuery(''));
    dispatch(setPanelMode('shared'));
  }, [isShowingAllShared, showAllSharedDocuments, dispatch, sharedDocuments]);

  const handleLoadMoreRoots = useCallback(() => {
    if (isSharedPanel) {
      if (!isSharedLoadingMore && sharedHasMore) {
        void loadMoreSharedDocuments();
      }
      return;
    }
    if (!isTrashPanel && !privateRootLoading) {
      void dispatch(fetchRootNodesThunk({ page: privateRootPage + 1, append: true }));
    }
  }, [
    isTrashPanel,
    isSharedPanel,
    dispatch,
    privateRootLoading,
    privateRootPage,
    isSharedLoadingMore,
    sharedHasMore,
    loadMoreSharedDocuments,
  ]);

  const openTrashDocumentsPanel = useCallback(() => {
    dispatch(setSearchQuery(''));
    dispatch(setPanelMode('trash'));
    void showTrashDocuments();
  }, [showTrashDocuments, dispatch]);

  const handleSetSearchQuery = useCallback(
    (query: string) => dispatch(setSearchQuery(query)),
    [dispatch]
  );

  const closeDocumentsPanel = useCallback(() => {
    dispatch(setPanelMode(null));
    dispatch(setSearchQuery(''));
  }, [dispatch]);

  const resolveSharedActionType = useCallback((doc: SidebarSectionDocument): DocActionType => {
    if ('relationship' in doc && doc.relationship === 'collaborator') {
      return 'leave-shared';
    }
    return 'move-to-trash';
  }, []);

  const resolveSharedTreeActionType = useCallback(
    (documentId: string): DocActionType => {
      const doc = sharedDocuments.find((entry) => entry.id === documentId);
      return doc ? resolveSharedActionType(doc) : 'move-to-trash';
    },
    [sharedDocuments, resolveSharedActionType]
  );

  const resolvePanelActionType = useCallback(
    (doc: SidebarSectionDocument): DocActionType =>
      isSharedPanel ? resolveSharedActionType(doc) : 'move-to-trash',
    [isSharedPanel, resolveSharedActionType]
  );

  const handleToggleDocumentActions = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, documentId: string, actionType: DocActionType) => {
      event.stopPropagation();
      const button = event.currentTarget;
      const rect = button.getBoundingClientRect();

      const newAnchor =
        docActionsAnchor?.documentId === documentId && docActionsAnchor.actionType === actionType
          ? null
          : {
              documentId,
              actionType,
              // Captured as plain numbers: a DOMRect's geometry lives on its
              // prototype, so spreading it would yield an empty object.
              trigger: {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              },
              // Measured instead of derived from `sidebarWidth` so the straddle
              // line also matches the documents panel, which is wider than the rail.
              panelEdgeX: sidebarRef.current?.getBoundingClientRect().right ?? null,
            };
      dispatch(setDocActionsAnchor(newAnchor));
    },
    [docActionsAnchor, dispatch]
  );

  const handleMoveToTrash = useCallback(
    async (docId: string) => {
      if (!isAuthenticated || !accessToken) {
        return;
      }

      try {
        await documentService.moveCloudDocumentToTrash(docId, accessToken);
        dispatch(setDocActionsAnchor(null));
        dispatch(removeNode(docId));
        dispatch(sharedRemoveNode(docId));

        if (activeDocId === docId) {
          await navigateToResolvedRootDocument({ excludedDocumentIds: [docId] });
        }

        await refresh(false);
        await refreshTrash(false);
      } catch (error) {
        console.error('Failed to move document to trash:', error);
        dispatch(
          addToast({
            message: 'Failed to move document to trash. Please try again.',
            type: 'error',
          })
        );
      }
    },
    [
      isAuthenticated,
      accessToken,
      activeDocId,
      navigateToResolvedRootDocument,
      refresh,
      refreshTrash,
      dispatch,
    ]
  );

  const handleRestoreFromTrash = useCallback(
    async (docId: string) => {
      if (!isAuthenticated || !accessToken) {
        return;
      }

      try {
        setTrashActionLoadingDocId(docId);
        await documentService.restoreCloudDocumentFromTrash(docId, accessToken);
        void dispatch(fetchRootNodesThunk());

        await refresh(false);
        await refreshTrash(false);
      } catch (error) {
        console.error('Failed to restore document from trash:', error);
        dispatch(
          addToast({ message: 'Failed to restore document. Please try again.', type: 'error' })
        );
      } finally {
        setTrashActionLoadingDocId(null);
      }
    },
    [isAuthenticated, accessToken, refresh, refreshTrash, dispatch]
  );

  const handleLeaveSharedDocument = useCallback(
    async (docId: string) => {
      if (!isAuthenticated || !accessToken) {
        return;
      }

      try {
        await documentService.leaveSharedDocument(docId, accessToken);
        dispatch(setDocActionsAnchor(null));

        if (activeDocId === docId) {
          await navigateToResolvedRootDocument({ excludedDocumentIds: [docId] });
        }

        await refresh(false);
      } catch (error) {
        console.error('Failed to leave shared document:', error);
        dispatch(
          addToast({ message: 'Failed to leave shared document. Please try again.', type: 'error' })
        );
      }
    },
    [isAuthenticated, accessToken, activeDocId, navigateToResolvedRootDocument, refresh, dispatch]
  );

  const handleRequestPermanentDelete = useCallback(
    (docId: string, title: string) => {
      dispatch(setPermanentDeleteTarget({ id: docId, title }));
    },
    [dispatch]
  );

  const handleConfirmPermanentDelete = useCallback(async () => {
    if (!isAuthenticated || !accessToken || !permanentDeleteTarget) {
      return;
    }

    const { id } = permanentDeleteTarget;

    try {
      setIsPermanentDeleteLoading(true);
      await documentService.deleteCloudDocumentPermanently(id, accessToken);
      dispatch(setPermanentDeleteTarget(null));

      if (activeDocId === id) {
        await navigateToResolvedRootDocument({ excludedDocumentIds: [id] });
      }

      await refresh(false);
      await refreshTrash(false);
    } catch (error) {
      console.error('Failed to permanently delete document:', error);
      dispatch(
        addToast({
          message: 'Failed to permanently delete document. Please try again.',
          type: 'error',
        })
      );
    } finally {
      setIsPermanentDeleteLoading(false);
    }
  }, [
    isAuthenticated,
    accessToken,
    permanentDeleteTarget,
    activeDocId,
    navigateToResolvedRootDocument,
    refresh,
    refreshTrash,
    dispatch,
  ]);

  if (!isClient) {
    return (
      <aside className="nd-left-sidebar w-64 border-r border-sidebar-border flex-shrink-0 bg-sidebar" />
    );
  }

  return (
    <aside
      ref={sidebarRef}
      data-mobile-nav={isMobileNavOpen ? 'open' : 'closed'}
      // Off-screen drawers are still keyboard-reachable, so hide the whole rail
      // from assistive tech and tab order while it is closed on mobile.
      inert={isMobileLayout && !isMobileNavOpen ? true : undefined}
      className={`nd-left-sidebar ${isRailCollapsed ? 'w-13 border-r-0' : 'border-r'} border-sidebar-border flex-shrink-0 flex flex-col ${isDocumentsPanelOpen ? '' : 'overflow-hidden'} bg-sidebar text-sidebar-foreground select-none ${isResizing ? 'transition-none' : 'transition-[width] duration-200 ease-out'} relative`}
      style={{
        width: isRailCollapsed ? undefined : `var(--nd-sidebar-width, ${sidebarWidth}px)`,
      }}
    >
      {/* Header */}
      {isRailCollapsed ? (
        <div className="flex flex-col p-2">
          <button
            type="button"
            onClick={() => {
              dispatch(setCollapsed(false));
              setIsSidebarCollapseHoverGuard(false);
            }}
            aria-label="Expand sidebar"
            aria-expanded={false}
            title="Expand sidebar"
            className={`flex items-center gap-3 px-2 py-2 rounded-sm text-sidebar-foreground/80 transition-colors duration-100 cursor-pointer overflow-hidden ${
              isSidebarCollapseHoverGuard
                ? ''
                : 'hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
          >
            <OpenSidebar size={21} className="flex-shrink-0 opacity-80" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 p-2 pr-3">
          <div className="flex items-center gap-2 py-1 px-1.5 rounded-sm cursor-pointer overflow-hidden">
            <NextDocs className="w-[26px] h-[26px] flex-shrink-0" />
            <span
              className="text-[22px] mt-[2px] font-[600] leading-none whitespace-nowrap"
              style={{
                fontFamily: 'var(--font-serif)',
                letterSpacing: '0.025em',
              }}
            >
              NextDocs
            </span>
          </div>

          {/*
            One control, two meanings: on desktop it docks the rail, on mobile it
            dismisses the drawer (which has nowhere to dock to).
          */}
          <button
            type="button"
            onClick={() => {
              if (isMobileLayout) {
                closeMobileNav();
                return;
              }
              dispatch(setAccountMenuOpen(false));
              dispatch(setCollapsed(true));
              setIsSidebarCollapseHoverGuard(true);
            }}
            aria-label={isMobileLayout ? 'Close navigation' : 'Collapse sidebar'}
            aria-expanded={true}
            title={isMobileLayout ? 'Close navigation' : 'Collapse sidebar'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-100 cursor-pointer flex-shrink-0"
          >
            {isMobileLayout ? (
              <Close size={20} className="flex-shrink-0 opacity-80" />
            ) : (
              <CloseSidebar size={21} className="flex-shrink-0 opacity-80" />
            )}
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col py-2 px-2">
        <button
          onClick={() => void handleCreateFile()}
          className="flex items-center gap-3 px-2 py-[7px] rounded-sm text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer overflow-hidden"
        >
          <NewDocument size={21} className="flex-shrink-0 opacity-80" />
          <span
            className="text-[14.5px] whitespace-nowrap"
            style={{
              opacity: isRailCollapsed ? 0 : 1,
              width: isRailCollapsed ? 0 : 'auto',
            }}
          >
            New Document
          </span>
        </button>

        <button
          onClick={openAllDocumentsPanel}
          className="flex items-center gap-3 px-2 py-[7px] rounded-sm text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer overflow-hidden"
        >
          <Search size={21} className="flex-shrink-0 opacity-80" />
          <span
            className="text-[14.5px] whitespace-nowrap"
            style={{
              opacity: isRailCollapsed ? 0 : 1,
              width: isRailCollapsed ? 0 : 'auto',
            }}
          >
            Search Documents
          </span>
        </button>
      </div>

      {/* Document sections and account menu */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        {!isRailCollapsed && (
          <div className="ml-1">
            <SidebarTreeDndContext treeApi={sidebarTreeApi}>
              <SidebarTree
                excludedNodeIds={excludedNodeIds}
                isOpen={isPrivateOpen}
                onToggle={() => dispatch(togglePrivateOpen())}
                activeDocId={activeDocId}
                onSelectDocument={(docId) => {
                  dispatch(setDocActionsAnchor(null));
                  handleSelectDocument(docId);
                }}
                onCreateChild={(parentId) => {
                  void handleCreateFile(parentId);
                }}
                isActionsEnabled={Boolean(isAuthenticated && accessToken)}
                docActionsAnchor={docActionsAnchor}
                onToggleDocumentActions={handleToggleDocumentActions}
                onShowAll={openAllDocumentsPanel}
              />

              {isAuthenticated && (
                <SharedTree
                  className="mt-1"
                  isOpen={isSharedOpen}
                  onToggle={() => dispatch(toggleSharedOpen())}
                  documents={sharedDocuments}
                  isLoading={isSharedLoading}
                  activeDocId={activeDocId}
                  onSelectDocument={(docId) => {
                    dispatch(setDocActionsAnchor(null));
                    handleSelectDocument(docId);
                  }}
                  onCreateChild={(parentId) => {
                    void handleCreateFile(parentId);
                  }}
                  isActionsEnabled={Boolean(isAuthenticated && accessToken)}
                  docActionsAnchor={docActionsAnchor}
                  onToggleDocumentActions={handleToggleDocumentActions}
                  resolveActionType={resolveSharedTreeActionType}
                  onShowAll={openSharedDocumentsPanel}
                />
              )}

              {/* Guests keep the section mounted while the roots load: the
                  section renders its skeleton rows from isLoading, which a
                  roots-empty gate would hide for the whole first request. */}
              {!isAuthenticated && (sharedTreeRootIds.length > 0 || isGuestSharedLoading) && (
                <SharedTree
                  className="mt-1"
                  isOpen={isSharedOpen}
                  onToggle={() => dispatch(toggleSharedOpen())}
                  documents={EMPTY_SHARED_DOCUMENTS}
                  isLoading={isGuestSharedLoading}
                  activeDocId={activeDocId}
                  onSelectDocument={(docId) => {
                    dispatch(setDocActionsAnchor(null));
                    handleSelectDocument(docId);
                  }}
                  onCreateChild={guestNoop}
                  isActionsEnabled={false}
                  docActionsAnchor={null}
                  onToggleDocumentActions={guestNoop}
                  resolveActionType={guestResolveActionType}
                />
              )}
            </SidebarTreeDndContext>
          </div>
        )}

        <div
          className={`relative mt-auto sticky bottom-0 ${isRailCollapsed ? '' : 'border-t border-border'} bg-sidebar p-2`}
        >
          <button
            ref={accountMenuTriggerRef}
            onClick={() => dispatch(setAccountMenuOpen(!isAccountMenuOpen))}
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
            className="group/account w-full rounded-sm px-1.5 py-2 text-left transition-colors hover:bg-sidebar-accent cursor-pointer flex items-center overflow-hidden"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-[23px] w-[23px] flex-shrink-0 items-center justify-center rounded-full bg-[#7d7a75]"
            >
              {isAuthenticated && user ? (
                <span className="text-[12px] text-white font-semibold leading-none select-none">
                  {userInitial}
                </span>
              ) : (
                <UserCircle className="h-[16px] w-[16px]" />
              )}
            </span>
            <span
              className="flex items-center min-w-0 overflow-hidden transition-all duration-300"
              style={{
                opacity: isRailCollapsed ? 0 : 1,
                width: isRailCollapsed ? 0 : 'calc(100% - 23px)',
                paddingLeft: isRailCollapsed ? 0 : '12px',
              }}
            >
              <span className="truncate text-[15px] whitespace-nowrap flex-1">{accountLabel}</span>
              <ChevronRight
                className={`flex-shrink-0 opacity-70 transition-transform duration-150 ${
                  isAccountMenuOpen ? '-rotate-90' : 'rotate-90'
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      {isAccountMenuOpen && (
        <ProfileMenuPopup
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          isAuthenticated={isAuthenticated}
          onOpenSettings={() => {
            dispatch(setAccountMenuOpen(false));
            dispatch(setSettingsModalOpen(true));
          }}
          onOpenTrash={() => {
            dispatch(setAccountMenuOpen(false));
            openTrashDocumentsPanel();
          }}
          onLogout={async () => {
            dispatch(setAccountMenuOpen(false));
            dispatch(resetSidebarTree());
            dispatch(resetSharedTree());
            await logout();
            await navigateToResolvedRootDocument({
              isAuthenticated: false,
              accessToken: null,
            });
          }}
          onOpenAuth={() => {
            dispatch(setAccountMenuOpen(false));
            dispatch(setAuthModalOpen(true));
          }}
          style={profileMenuStyle}
          popupRef={accountMenuPopupRef}
        />
      )}

      {isSettingsOpen && <SettingsModal onClose={() => dispatch(setSettingsModalOpen(false))} />}

      {docActionsAnchor && (
        <DocumentActionsMenu
          anchor={docActionsAnchor}
          resolvedTheme={resolvedTheme}
          onLeaveShared={handleLeaveSharedDocument}
          onMoveToTrash={handleMoveToTrash}
        />
      )}

      {isDocumentsPanelOpen && (
        <DocumentsPanel
          mode={documentsPanelMode}
          sidebarWidth={sidebarWidth}
          isSidebarCollapsed={isRailCollapsed}
          searchQuery={searchQuery}
          setSearchQuery={handleSetSearchQuery}
          onClose={closeDocumentsPanel}
          isLoadingInitial={panelIsLoadingInitial}
          filteredDocuments={filteredDocuments}
          trashedDocuments={trashedDocuments}
          treeApi={panelTreeApi}
          excludedNodeIds={isPrivatePanel ? excludedNodeIds : undefined}
          visibleRootIds={visibleRootIds}
          visibleIds={visibleIds}
          isSearching={isPanelSearching}
          onCreateChild={(parentId) => {
            void handleCreateFile(parentId);
          }}
          rootHasMore={isSharedPanel ? sharedHasMore : !isTrashPanel ? privateRootHasMore : false}
          isLoadingRootMore={
            isSharedPanel
              ? isSharedLoadingMore
              : !isTrashPanel
                ? privateRootLoading && privateTreeRootIds.length > 0
                : false
          }
          onLoadMoreRoots={handleLoadMoreRoots}
          activeDocId={activeDocId}
          isAuthenticated={isAuthenticated}
          accessToken={accessToken}
          trashActionLoadingDocId={trashActionLoadingDocId}
          isPermanentDeleteLoading={isPermanentDeleteLoading}
          onSelectDocument={handleSelectDocument}
          onRestoreFromTrash={handleRestoreFromTrash}
          onRequestPermanentDelete={handleRequestPermanentDelete}
          docActionsAnchor={docActionsAnchor}
          onToggleDocumentActions={handleToggleDocumentActions}
          resolvePanelActionType={resolvePanelActionType}
          resolvePanelTreeActionType={resolvePanelTreeActionType}
          setDocActionsAnchor={(anchor) => dispatch(setDocActionsAnchor(anchor))}
          hasMore={panelHasMore}
          isLoadingMore={panelIsLoadingMore}
          onLoadMore={handleLoadMore}
        />
      )}

      <ConfirmationModal
        isOpen={Boolean(permanentDeleteTarget)}
        title="Delete permanently?"
        description={
          permanentDeleteTarget
            ? `"${permanentDeleteTarget.title}" will be permanently deleted and cannot be recovered.`
            : 'This document will be permanently deleted and cannot be recovered.'
        }
        confirmLabel="Delete Permanently"
        cancelLabel="Cancel"
        tone="danger"
        isConfirming={isPermanentDeleteLoading}
        onCancel={() => {
          if (!isPermanentDeleteLoading) {
            dispatch(setPermanentDeleteTarget(null));
          }
        }}
        onConfirm={() => {
          void handleConfirmPermanentDelete();
        }}
      />

      {!isRailCollapsed && (
        <div
          onPointerDown={startResizing}
          onMouseDown={(e) => {
            if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
            startResizing(e);
          }}
          className="nd-sidebar-resize-handle absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-sidebar-border/80 active:bg-sidebar-ring z-50 transition-colors touch-none"
        />
      )}
    </aside>
  );
}

export default memo(Sidebar);
