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
  toggleSpacesOpen,
  setDocActionsAnchor,
} from '@/stores/sidebar/sidebar.slice';
import {
  closeSettingsDialog,
  openSettingsDialog,
  setAccountMenuOpen,
  setWorkspaceMenuOpen,
  setPermanentDeleteTarget,
} from '@/stores/ui/ui.slice';
import { addToast } from '@/stores/toasts/toasts.slice';

import { NewDocument, Search, ChevronDown, Close, CloseSidebar, UserCircle } from '@/icons';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { PageIcon } from '@/components/page/PageIcon';
import { useTheme } from '@/hooks/useTheme.hook';
import { useAuth } from '@/hooks/useAuth.hook';
import { useWorkspace } from '@/hooks/useWorkspace.hook';
import { useOfflineDocumentSelect } from '@/hooks/useOfflineDocumentSelect.hook';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { generateDocumentId } from '@/lib/document-id.util';
import { sanitizeDocumentIcon } from '@/lib/document-icon.util';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '@/lib/offline-navigation.util';
import { clearLocalDocumentParent, setLocalDocumentParent } from '@/lib/local-tree.util';
import {
  discardPendingDocument,
  getPendingCloudCreate,
  isPermanentCreateFailure,
  PENDING_DOCUMENT_DISCARDED_EVENT,
  queuePendingCloudCreate,
} from '@/lib/pending-cloud-create.util';
import { resolveRootDocumentId } from '@/lib/root-document.util';
import {
  isSidebarDropAllowed,
  resolveSidebarMoveRoute,
  type SidebarDropZone,
} from '@/lib/sidebar-drop-rules';

import {
  addNode,
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
import {
  removeDocument as removeSpaceTreeDocument,
  resetAllTrees as resetSpaceTrees,
} from '@/stores/spaceTree/spaceTree.slice';

// Import sub-components
import { SharedTree } from './SharedTree';
import { SidebarTree } from './SidebarTree';
import { SpacesSection } from './SpacesSection';
import { WorkspaceLockup } from './WorkspaceLockup';
import { WorkspaceMenuPopup } from './WorkspaceMenuPopup';
import { ProfileMenuPopup } from './ProfileMenuPopup';
import { DocumentActionsMenu } from './DocumentActionsMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { useSidebarResize } from './useSidebarResize';
import { useDismissableMenu } from './useDismissableMenu';
import { resolvePopupPosition } from './popup-position.util';
import { canManageMembers } from '@/components/settings/workspace/workspace-role.util';
import {
  SidebarTreeDndContext,
  type MoveDocumentArgs,
  type TreeApi,
} from './SidebarTreeDndContext';

import type { SharedDocumentEntry } from '@/stores/documentList/documentList.types';
import type { DocActionType, SidebarSectionDocument } from './types';

const emptySubscribe = () => () => {};

// Stable empty list for the guest Shared section (guests have no document
// list); a fresh literal per render would re-run the roots sync effect.
const EMPTY_SHARED_DOCUMENTS: SharedDocumentEntry[] = [];
const guestNoop = () => {};
const guestResolveActionType = () => 'move-to-trash' as const;

// Shared geometry for the header's rail control and the footer spacer beside
// the account row, so the two rows stay aligned.
const SIDEBAR_RAIL_CONTROL_CLASS = 'h-9 w-12 flex-shrink-0 md:h-7 md:w-9';

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
  const workspace = useWorkspace();
  const workspaceName = workspace?.name ?? 'NextDocs';
  const workspaceIcon = sanitizeDocumentIcon(workspace?.icon);
  const hasManagePeopleAccess = Boolean(workspace && canManageMembers(workspace.role));
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
  const isSpacesOpen = useAppSelector((state) => state.sidebar.isSpacesOpen);
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
  const closeMobileNav = useCallback(() => dispatch(setMobileNavOpen(false)), [dispatch]);

  const [offlineSelectedDocumentId, setOfflineSelectedDocumentId] = useState<string | null>(null);
  const isAccountMenuOpen = useAppSelector((state) => state.ui.isAccountMenuOpen);
  const isWorkspaceMenuOpen = useAppSelector((state) => state.ui.isWorkspaceMenuOpen);
  const isSettingsOpen = useAppSelector((state) => state.ui.isSettingsDialogOpen);
  const settingsEntryId = useAppSelector((state) => state.ui.settingsDialogEntryId);
  const settingsSource = useAppSelector((state) => state.ui.settingsDialogSource);
  const permanentDeleteTarget = useAppSelector((state) => state.ui.permanentDeleteTarget);
  const [trashActionLoadingDocId, setTrashActionLoadingDocId] = useState<string | null>(null);
  const [isPermanentDeleteLoading, setIsPermanentDeleteLoading] = useState(false);
  // Menus render at the rail root (the tree scrolls and would clip them), so
  // each carries a position measured from its trigger when it opens.
  const [accountMenuPosition, setAccountMenuPosition] = useState<React.CSSProperties | null>(null);
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState<React.CSSProperties | null>(
    null
  );

  const activeDocId = offlineSelectedDocumentId ?? routeActiveDocId;
  const { isGuestSharedLoading } = useGuestSharedTree(isAuthenticated ? '' : activeDocId);
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuPopupRef = useRef<HTMLDivElement>(null);
  const workspaceMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceMenuPopupRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const isDocumentsPanelOpen = documentsPanelMode !== null;
  const isTrashPanel = documentsPanelMode === 'trash';
  const isSharedPanel = documentsPanelMode === 'shared';

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
          .then(() => {
            // Keep the offline tree fallback in sync with the move.
            setLocalDocumentParent(args.documentId, args.newParentId);
          })
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
            clearLocalDocumentParent(args.documentId);
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

  // Guests sign in from here; carrying this route back (path and share params)
  // returns them to the document they were reading instead of the root.
  const goToSignIn = useCallback(() => {
    const next = `${window.location.pathname}${window.location.search}`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }, [router]);

  const handleCreateFile = useCallback(
    async (parentId?: string) => {
      closeMobileNav();

      // Guests only ever see documents shared with them; private documents
      // need an account, so creation becomes a sign-in prompt.
      if (!isAuthenticated || !accessToken) {
        goToSignIn();
        return;
      }

      try {
        const newId = generateDocumentId();
        const created = await documentService.createDocument();
        await documentService.saveDocument(newId, created.ydoc, created.meta);
        setLocalDocumentParent(newId, parentId ?? null);

        // Show the local copy immediately, under its real parent. The cloud
        // refresh below (or the offline queue replay) reconciles it later.
        if (!parentId || !sharedTreeNodes[parentId]) {
          dispatch(
            addNode({
              id: newId,
              title: created.meta.title || 'Untitled',
              parentId: parentId ?? null,
              orderKey: `local:${newId}`,
              hasChildren: false,
              effectiveAccessLevel: 'OWNER',
              createdAt: created.meta.createdAt,
              updatedAt: created.meta.updatedAt,
              icon: created.meta.icon ?? null,
            })
          );
        }

        // The local copy exists first, so creation must not fail just because
        // the cloud is unreachable. Queue the server-side create instead.
        let queuedForCloud = false;

        if (user?.id) {
          const queueCreate = () => {
            queuePendingCloudCreate({
              id: newId,
              userId: user.id,
              parentId: parentId ?? null,
            });
            // The sidebar tree reads the cloud, so it needs a nudge to fall back
            // to IndexedDB and show the copy that exists before the cloud row.
            documentService.emitLocalDocumentsChanged();
            queuedForCloud = true;
          };

          if (navigator.onLine === false) {
            queueCreate();
          } else {
            try {
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
            } catch (error) {
              // Only a definitive refusal may delete the local copy. Everything
              // else (offline, 401, 408, 429, 5xx, malformed response) stays
              // queued, matching what a replayed create is allowed to discard.
              if (isPermanentCreateFailure(error)) {
                // The server refused the create, so forget the copy: a node
                // left behind would open a document that does not exist.
                await discardPendingDocument(newId);
                throw error;
              }
              queueCreate();
            }
          }
        }

        await refresh(false);

        // Router navigation fetches an RSC payload, which cannot succeed
        // offline. Use the existing in-place selection path in that case.
        if (queuedForCloud || navigator.onLine === false) {
          window.dispatchEvent(
            new CustomEvent(OFFLINE_DOCUMENT_SELECT_EVENT, {
              detail: { id: newId },
            })
          );
        } else {
          router.push(`/doc/${newId}`);
        }
      } catch (error) {
        console.error('Failed to create document:', error);
        dispatch(
          addToast({ message: 'Failed to create document. Please try again.', type: 'error' })
        );
      }
    },
    [
      router,
      goToSignIn,
      refresh,
      isAuthenticated,
      accessToken,
      user?.id,
      dispatch,
      sharedTreeNodes,
      closeMobileNav,
    ]
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
      const nextIsAuthenticated = options?.isAuthenticated ?? isAuthenticated;

      // A signed-out user has no private root; the home route shows the
      // sign-in prompt instead of creating a guest document.
      if (!nextIsAuthenticated || !nextAccessToken) {
        router.replace('/');
        return;
      }

      const nextDocumentId = await resolveRootDocumentId({
        isAuthenticated: nextIsAuthenticated,
        accessToken: nextAccessToken,
        excludedDocumentIds: options?.excludedDocumentIds,
        userId: user?.id ?? null,
      });

      router.replace(nextDocumentId ? `/doc/${nextDocumentId}` : '/');
    },
    [router, isAuthenticated, accessToken, user?.id]
  );

  useOfflineDocumentSelect(setOfflineSelectedDocumentId);

  // The queue can discard a document from outside the sidebar (replay or an
  // open editor), so the tree listens instead of leaving a ghost row behind.
  useEffect(() => {
    const handlePendingDocumentDiscarded = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string } | undefined>).detail;
      if (!detail?.id) {
        return;
      }

      dispatch(removeNode(detail.id));
      dispatch(sharedRemoveNode(detail.id));
    };

    window.addEventListener(
      PENDING_DOCUMENT_DISCARDED_EVENT,
      handlePendingDocumentDiscarded as EventListener
    );
    return () => {
      window.removeEventListener(
        PENDING_DOCUMENT_DISCARDED_EVENT,
        handlePendingDocumentDiscarded as EventListener
      );
    };
  }, [dispatch]);

  useEffect(() => {
    if (!offlineSelectedDocumentId) {
      return;
    }

    if (routeActiveDocId === offlineSelectedDocumentId) {
      setOfflineSelectedDocumentId(null);
    }
  }, [routeActiveDocId, offlineSelectedDocumentId]);

  const closeAccountMenu = useCallback(() => dispatch(setAccountMenuOpen(false)), [dispatch]);
  const closeWorkspaceMenu = useCallback(() => dispatch(setWorkspaceMenuOpen(false)), [dispatch]);

  // An open menu dismisses itself on an outside press, which is also what keeps
  // the two menus exclusive: the press before the other trigger's click closes
  // this one.
  useDismissableMenu({
    isOpen: isAccountMenuOpen,
    triggerRef: accountMenuTriggerRef,
    popupRef: accountMenuPopupRef,
    onDismiss: closeAccountMenu,
  });
  useDismissableMenu({
    isOpen: isWorkspaceMenuOpen,
    triggerRef: workspaceMenuTriggerRef,
    popupRef: workspaceMenuPopupRef,
    onDismiss: closeWorkspaceMenu,
  });

  const toggleAccountMenu = useCallback(() => {
    if (isAccountMenuOpen) {
      dispatch(setAccountMenuOpen(false));
      return;
    }

    setAccountMenuPosition(resolvePopupPosition(accountMenuTriggerRef.current, 'above'));
    dispatch(setAccountMenuOpen(true));
  }, [isAccountMenuOpen, dispatch]);

  const toggleWorkspaceMenu = useCallback(() => {
    if (isWorkspaceMenuOpen) {
      dispatch(setWorkspaceMenuOpen(false));
      return;
    }

    setWorkspaceMenuPosition(resolvePopupPosition(workspaceMenuTriggerRef.current, 'below'));
    dispatch(setWorkspaceMenuOpen(true));
  }, [isWorkspaceMenuOpen, dispatch]);

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

      // A document created offline has no cloud row to trash (and trashing it
      // would 404). Dropping the queued create and the local copy is the whole
      // delete for it.
      if (getPendingCloudCreate(docId, user?.id ?? null)) {
        await discardPendingDocument(docId);
        dispatch(setDocActionsAnchor(null));

        if (activeDocId === docId) {
          await navigateToResolvedRootDocument({ excludedDocumentIds: [docId] });
        }

        await refresh(false);
        return;
      }

      try {
        await documentService.moveCloudDocumentToTrash(docId, accessToken);
        dispatch(setDocActionsAnchor(null));
        dispatch(removeNode(docId));
        dispatch(sharedRemoveNode(docId));
        dispatch(removeSpaceTreeDocument(docId));

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
      user?.id,
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

  // Desktop collapse removes the rail outright; the app shell's navigation
  // toggle is the only way back in. Mobile keeps it mounted as a drawer.
  if (isSidebarCollapsed && !isMobileLayout) {
    return null;
  }

  return (
    <aside
      ref={sidebarRef}
      data-mobile-nav={isMobileNavOpen ? 'open' : 'closed'}
      // Off-screen drawers are still keyboard-reachable, so hide the whole rail
      // from assistive tech and tab order while it is closed on mobile.
      inert={isMobileLayout && !isMobileNavOpen ? true : undefined}
      className={`nd-left-sidebar border-r border-sidebar-border flex-shrink-0 flex flex-col ${isDocumentsPanelOpen ? '' : 'overflow-hidden'} bg-sidebar text-sidebar-foreground select-none ${isResizing ? 'transition-none' : 'transition-[width] duration-200 ease-out'} relative`}
      style={{
        width: `var(--nd-sidebar-width, ${sidebarWidth}px)`,
      }}
    >
      {/* Header — one toolbar row: workspace identity, then the rail control. */}
      <div className="flex items-center justify-between gap-2 px-1.5 pt-2">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {/* Guests have no workspace pages to open, so the lockup stays a label. */}
          {isAuthenticated ? (
            <button
              ref={workspaceMenuTriggerRef}
              type="button"
              onClick={toggleWorkspaceMenu}
              aria-haspopup="menu"
              aria-expanded={isWorkspaceMenuOpen}
              aria-label={`${workspaceName} workspace options`}
              className="group/workspace flex min-w-0 flex-1 items-center gap-1 rounded-sm p-0.5 text-left transition-colors hover:bg-sidebar-accent cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            >
              <WorkspaceLockup name={workspaceName} workspaceIcon={workspaceIcon} />
              <ChevronDown
                className={`flex-shrink-0 transition-all duration-150 ${
                  isWorkspaceMenuOpen
                    ? 'opacity-70 rotate-180 w-3.5 mr-1'
                    : 'w-0 opacity-0 group-hover/workspace:w-3.5 group-hover/workspace:mr-1 group-hover/workspace:opacity-70 group-focus-visible/workspace:w-3.5 group-focus-visible/workspace:mr-1 group-focus-visible/workspace:opacity-70 overflow-hidden'
                }`}
                size={14}
              />
            </button>
          ) : (
            <span className="flex min-w-0 flex-1 items-center p-0.5">
              <WorkspaceLockup name={workspaceName} workspaceIcon={workspaceIcon} />
            </span>
          )}
        </div>

        {/*
          One control, two meanings: on desktop it closes the rail, on mobile it
          dismisses the drawer (which has nowhere to close to).
        */}
        <button
          type="button"
          onClick={() => {
            if (isMobileLayout) {
              closeMobileNav();
              return;
            }
            dispatch(setAccountMenuOpen(false));
            dispatch(setWorkspaceMenuOpen(false));
            dispatch(setCollapsed(true));
          }}
          aria-label={isMobileLayout ? 'Close navigation' : 'Collapse sidebar'}
          title={isMobileLayout ? 'Close navigation' : 'Collapse sidebar'}
          className={`inline-flex ${SIDEBAR_RAIL_CONTROL_CLASS} items-center justify-center rounded-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer`}
        >
          {isMobileLayout ? (
            <Close size={18} className="flex-shrink-0 opacity-80" />
          ) : (
            <CloseSidebar size={18} className="flex-shrink-0 opacity-80" />
          )}
        </button>
      </div>

      {/* Quick actions: a search surface with the create control beside it. */}
      <div className="flex items-center gap-2 px-2 pt-5 pb-4">
        <button
          type="button"
          onClick={openAllDocumentsPanel}
          aria-label="Search Documents"
          title="Search Documents"
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border border-sidebar-border bg-sidebar-accent/40 px-2.5 text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring md:h-8"
        >
          <Search size={16} className="flex-shrink-0 opacity-80" />
          <span className="truncate text-[13.5px] text-sidebar-foreground/70">Search</span>
        </button>
        <button
          type="button"
          onClick={() => void handleCreateFile()}
          aria-label="New document"
          title="New document"
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm border border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring md:h-8 md:w-8"
        >
          <NewDocument size={17} className="flex-shrink-0 opacity-80" />
        </button>
      </div>

      {/* Document sections and account menu */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        <div className="ml-1">
          {/* Spaces sit above the documents: their documents are no longer part of
              the Private tree, so this is where a filed document is reachable. */}
          {isAuthenticated && accessToken && (
            <SpacesSection
              accessToken={accessToken}
              activeDocId={activeDocId}
              isOpen={isSpacesOpen}
              onToggle={() => dispatch(toggleSpacesOpen())}
              onSelectDocument={(documentId) => {
                dispatch(setDocActionsAnchor(null));
                handleSelectDocument(documentId);
              }}
              selfId={user?.id ?? null}
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              sidebarRef={sidebarRef}
              docActionsAnchor={docActionsAnchor}
              onToggleDocumentActions={handleToggleDocumentActions}
              className="mb-1"
            />
          )}

          <SidebarTreeDndContext treeApi={sidebarTreeApi}>
            {/* Guests have no private workspace: their only documents are
                  share links, which the Shared section below lists. */}
            {isAuthenticated && (
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
            )}

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

        <div className="relative mt-auto sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-sidebar px-1.5 py-2">
          <button
            ref={accountMenuTriggerRef}
            onClick={toggleAccountMenu}
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
            className="group/account flex min-w-0 flex-1 items-center overflow-hidden rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent cursor-pointer"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-[25px] w-[25px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--nd-placeholder-bg)] text-[var(--nd-placeholder-fg)]"
            >
              {isAuthenticated && user ? (
                <span className="text-[13px] font-semibold leading-none select-none">
                  {userInitial}
                </span>
              ) : (
                <UserCircle className="h-[16px] w-[16px]" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-3">
              <span className="truncate text-[15px] whitespace-nowrap flex-1">{accountLabel}</span>
              <ChevronDown
                className={`flex-shrink-0 transition-all duration-150 ${
                  isAccountMenuOpen
                    ? 'opacity-70 -rotate-180 w-3.5'
                    : 'w-0 opacity-0 group-hover/account:w-3.5 group-hover/account:opacity-70 group-focus-visible/account:w-3.5 group-focus-visible/account:opacity-70 overflow-hidden'
                }`}
                size={14}
              />
            </span>
          </button>
          {/* Balances the header's rail control so both rows share an edge. */}
          <div className={SIDEBAR_RAIL_CONTROL_CLASS} aria-hidden="true" />
        </div>
      </div>

      {isAuthenticated && isWorkspaceMenuOpen && workspaceMenuPosition && (
        <WorkspaceMenuPopup
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          canManageMembers={hasManagePeopleAccess}
          onOpenWorkspaceSettings={() => {
            dispatch(closeWorkspaceMenu());
            dispatch(openSettingsDialog({ entryId: 'workspace-general', source: 'workspace' }));
          }}
          onOpenPeople={() => {
            dispatch(closeWorkspaceMenu());
            dispatch(openSettingsDialog({ entryId: 'workspace-people', source: 'workspace' }));
          }}
          onOpenTrash={() => {
            dispatch(closeWorkspaceMenu());
            openTrashDocumentsPanel();
          }}
          style={workspaceMenuPosition}
          popupRef={workspaceMenuPopupRef}
        />
      )}

      {isAccountMenuOpen && accountMenuPosition && (
        <ProfileMenuPopup
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          isAuthenticated={isAuthenticated}
          onOpenProfile={() => {
            dispatch(closeAccountMenu());
            dispatch(openSettingsDialog({ entryId: 'profile', source: 'account' }));
          }}
          onOpenPreferences={() => {
            dispatch(closeAccountMenu());
            dispatch(openSettingsDialog({ entryId: 'preferences', source: 'account' }));
          }}
          onOpenSettings={() => {
            dispatch(closeAccountMenu());
            dispatch(openSettingsDialog({ source: 'account' }));
          }}
          onLogout={async () => {
            dispatch(setAccountMenuOpen(false));
            dispatch(resetSidebarTree());
            dispatch(resetSharedTree());
            dispatch(resetSpaceTrees());
            await logout();
            await navigateToResolvedRootDocument({
              isAuthenticated: false,
              accessToken: null,
            });
          }}
          onSignIn={() => {
            dispatch(closeAccountMenu());
            goToSignIn();
          }}
          style={accountMenuPosition}
          popupRef={accountMenuPopupRef}
        />
      )}

      {isSettingsOpen && (
        <SettingsDialog
          initialEntryId={settingsEntryId}
          returnFocusRef={
            settingsSource === 'workspace' ? workspaceMenuTriggerRef : accountMenuTriggerRef
          }
          onClose={() => dispatch(closeSettingsDialog())}
        />
      )}

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

      <div
        onPointerDown={startResizing}
        onMouseDown={(e) => {
          if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
          startResizing(e);
        }}
        className="nd-sidebar-resize-handle absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-sidebar-border/80 active:bg-sidebar-ring z-50 transition-colors touch-none"
      />
    </aside>
  );
}

export default memo(Sidebar);
