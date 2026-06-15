'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { memo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useDocumentList } from '@/hooks/useDocumentList.hook';
import { documentService } from '@/services/document.service';
import {
  NewDocument,
  Search,
  ChevronRight,
  NextDocs,
  CloseSidebar,
  OpenSidebar,
  UserCircle,
} from '@/icons';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { SettingsModal } from '@/components/SettingsModal';
import { useTheme } from '@/hooks/useTheme.hook';
import { useAuth } from '@/hooks/useAuth.hook';
import { useOfflineDocumentSelect } from '@/hooks/useOfflineDocumentSelect.hook';
import { generateDocumentId } from '@/lib/document-id.util';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '@/lib/offline-navigation.util';
import { resolveRootDocumentId } from '@/lib/root-document.util';

// Import sub-components
import { SidebarDocumentSection } from './SidebarDocumentSection';
import { ProfileMenuPopup } from './ProfileMenuPopup';
import { DocumentActionsMenu } from './DocumentActionsMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { useSidebarResize } from './useSidebarResize';

import { SIDEBAR_VISIBLE_COUNT } from './types';
import type {
  DocumentsPanelMode,
  DocActionType,
  DocActionsAnchor,
  SidebarSectionDocument,
} from './types';

const emptySubscribe = () => () => {};
const SIDEBAR_COLLAPSE_HOVER_GUARD_MS = 260;

function Sidebar({ onOpenAuth }: { onOpenAuth: () => void }) {
  const router = useRouter();
  const params = useParams();
  const routeActiveDocId = (params?.id as string) || '';
  const {
    documents,
    sharedDocuments = [],
    trashedDocuments,
    isLoading,
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

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { sidebarWidth, isResizing, startResizing } = useSidebarResize();

  const [offlineSelectedDocumentId, setOfflineSelectedDocumentId] = useState<string | null>(null);
  const [isPrivateOpen, setIsPrivateOpen] = useState(true);
  const [isSharedOpen, setIsSharedOpen] = useState(true);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [documentsPanelMode, setDocumentsPanelMode] = useState<DocumentsPanelMode>(null);
  const [docActionsAnchor, setDocActionsAnchor] = useState<DocActionsAnchor | null>(null);
  const [trashActionLoadingDocId, setTrashActionLoadingDocId] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isPermanentDeleteLoading, setIsPermanentDeleteLoading] = useState(false);
  const [isSidebarCollapseHoverGuard, setIsSidebarCollapseHoverGuard] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const activeDocId = offlineSelectedDocumentId ?? routeActiveDocId;
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuPopupRef = useRef<HTMLDivElement>(null);

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
  const panelIsLoadingInitial = isTrashPanel
    ? isTrashLoading
    : isSharedPanel
      ? isSharedLoading && panelDocuments.length === 0
      : isLoading && panelDocuments.length === 0;

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return panelDocuments;
    }

    return panelDocuments.filter((doc) =>
      (doc.meta.title || 'Untitled').toLowerCase().includes(query)
    );
  }, [panelDocuments, searchQuery]);

  // Use useSyncExternalStore to safely detect if we are on the client
  // without triggering "cascading render" lint errors or hydration mismatches.
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const handleCreateFile = useCallback(async () => {
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
          created.meta.createdBy ?? null
        );
      }

      await refresh(false);
      router.push(`/doc/${newId}`);
    } catch (error) {
      console.error('Failed to create document:', error);
      // TODO: Replace alert with a non-blocking notification system (e.g., toast)
      alert('Failed to create document. Please try again.');
    }
  }, [router, refresh, isAuthenticated, accessToken]);

  const handleSelectDocument = useCallback(
    (id: string) => {
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
    [router]
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
        setIsAccountMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAccountMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAccountMenuOpen]);

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

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-doc-actions-root='${docActionsAnchor.documentId}']`)) {
        setDocActionsAnchor(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDocActionsAnchor(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [docActionsAnchor]);

  const openAllDocumentsPanel = useCallback(() => {
    if (!isShowingAll) {
      showAllDocuments();
    }
    setSearchQuery('');
    setDocumentsPanelMode('all');
  }, [isShowingAll, showAllDocuments]);

  const openSharedDocumentsPanel = useCallback(() => {
    if (!isShowingAllShared) {
      showAllSharedDocuments();
    }
    setSearchQuery('');
    setDocumentsPanelMode('shared');
  }, [isShowingAllShared, showAllSharedDocuments]);

  const openTrashDocumentsPanel = useCallback(() => {
    setSearchQuery('');
    setDocumentsPanelMode('trash');
    void showTrashDocuments();
  }, [showTrashDocuments]);

  const closeDocumentsPanel = useCallback(() => {
    setDocumentsPanelMode(null);
    setSearchQuery('');
  }, []);

  const resolveSharedActionType = useCallback((doc: SidebarSectionDocument): DocActionType => {
    if ('relationship' in doc && doc.relationship === 'collaborator') {
      return 'leave-shared';
    }
    return 'move-to-trash';
  }, []);

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

      setDocActionsAnchor((prev) => {
        if (prev?.documentId === documentId && prev.actionType === actionType) {
          return null;
        }

        return {
          documentId,
          actionType,
          x: rect.right + 8,
          y: rect.top + rect.height / 2,
        };
      });
    },
    []
  );

  const handleMoveToTrash = useCallback(
    async (docId: string) => {
      if (!isAuthenticated || !accessToken) {
        return;
      }

      try {
        await documentService.moveCloudDocumentToTrash(docId, accessToken);
        setDocActionsAnchor(null);

        if (activeDocId === docId) {
          await navigateToResolvedRootDocument({ excludedDocumentIds: [docId] });
        }

        await refresh(false);
        await refreshTrash(false);
      } catch (error) {
        console.error('Failed to move document to trash:', error);
        alert('Failed to move document to trash. Please try again.');
      }
    },
    [
      isAuthenticated,
      accessToken,
      activeDocId,
      navigateToResolvedRootDocument,
      refresh,
      refreshTrash,
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

        await refresh(false);
        await refreshTrash(false);
      } catch (error) {
        console.error('Failed to restore document from trash:', error);
        alert('Failed to restore document. Please try again.');
      } finally {
        setTrashActionLoadingDocId(null);
      }
    },
    [isAuthenticated, accessToken, refresh, refreshTrash]
  );

  const handleLeaveSharedDocument = useCallback(
    async (docId: string) => {
      if (!isAuthenticated || !accessToken) {
        return;
      }

      try {
        await documentService.leaveSharedDocument(docId, accessToken);
        setDocActionsAnchor(null);

        if (activeDocId === docId) {
          await navigateToResolvedRootDocument({ excludedDocumentIds: [docId] });
        }

        await refresh(false);
      } catch (error) {
        console.error('Failed to leave shared document:', error);
        alert('Failed to leave shared document. Please try again.');
      }
    },
    [isAuthenticated, accessToken, activeDocId, navigateToResolvedRootDocument, refresh]
  );

  const handleRequestPermanentDelete = useCallback((docId: string, title: string) => {
    setPermanentDeleteTarget({ id: docId, title });
  }, []);

  const handleConfirmPermanentDelete = useCallback(async () => {
    if (!isAuthenticated || !accessToken || !permanentDeleteTarget) {
      return;
    }

    const { id } = permanentDeleteTarget;

    try {
      setIsPermanentDeleteLoading(true);
      await documentService.deleteCloudDocumentPermanently(id, accessToken);
      setPermanentDeleteTarget(null);

      if (activeDocId === id) {
        await navigateToResolvedRootDocument({ excludedDocumentIds: [id] });
      }

      await refresh(false);
      await refreshTrash(false);
    } catch (error) {
      console.error('Failed to permanently delete document:', error);
      alert('Failed to permanently delete document. Please try again.');
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
  ]);

  if (!isClient) {
    return <aside className="w-64 border-r border-sidebar-border flex-shrink-0 bg-sidebar" />;
  }

  return (
    <aside
      className={`${isSidebarCollapsed ? 'w-13 border-r-0' : 'border-r'} border-sidebar-border flex-shrink-0 flex flex-col ${isDocumentsPanelOpen ? '' : 'overflow-hidden'} bg-sidebar text-sidebar-foreground select-none ${isResizing ? 'transition-none' : 'transition-all duration-300'} relative`}
      style={{
        width: isSidebarCollapsed ? undefined : `${sidebarWidth}px`,
      }}
    >
      {/* Header */}
      {isSidebarCollapsed ? (
        <div className="flex flex-col p-2">
          <button
            type="button"
            onClick={() => {
              setIsSidebarCollapsed(false);
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
            <OpenSidebar size={20} className="flex-shrink-0 opacity-80" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between p-2">
          <div className="flex items-center gap-2 py-1 px-1.5 rounded-sm cursor-pointer overflow-hidden">
            <NextDocs className="w-[25px] h-[25px] flex-shrink-0" />
            <span
              className="text-[21px] mt-[2px] font-[600] leading-none whitespace-nowrap"
              style={{
                fontFamily: 'var(--font-serif)',
                letterSpacing: '0.025em',
              }}
            >
              NextDocs
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsAccountMenuOpen(false);
              setIsSidebarCollapsed(true);
              setIsSidebarCollapseHoverGuard(true);
            }}
            aria-label="Collapse sidebar"
            aria-expanded={true}
            title="Collapse sidebar"
            className="inline-flex px-2 py-2 items-center justify-center rounded-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-100 cursor-pointer flex-shrink-0"
          >
            <CloseSidebar size={20} className="flex-shrink-0 opacity-80" />
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col py-2 px-2">
        <button
          onClick={handleCreateFile}
          className="flex items-center gap-3 px-2 py-[7px] rounded-sm text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer overflow-hidden"
        >
          <NewDocument size={20} className="flex-shrink-0 opacity-80" />
          <span
            className="text-[13.5px] whitespace-nowrap"
            style={{
              opacity: isSidebarCollapsed ? 0 : 1,
              width: isSidebarCollapsed ? 0 : 'auto',
            }}
          >
            New Document
          </span>
        </button>

        <button
          onClick={openAllDocumentsPanel}
          className="flex items-center gap-3 px-2 py-[7px] rounded-sm text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer overflow-hidden"
        >
          <Search size={20} className="flex-shrink-0 opacity-80" />
          <span
            className="text-[13.5px] whitespace-nowrap"
            style={{
              opacity: isSidebarCollapsed ? 0 : 1,
              width: isSidebarCollapsed ? 0 : 'auto',
            }}
          >
            Search Documents
          </span>
        </button>
      </div>

      {/* Document sections and account menu */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        {!isSidebarCollapsed && (
          <div className="ml-1">
            <SidebarDocumentSection
              title="Private"
              isOpen={isPrivateOpen}
              onToggle={() => setIsPrivateOpen((prev) => !prev)}
              documents={documents}
              isLoading={isLoading}
              emptyText="No documents yet"
              activeDocId={activeDocId}
              onSelectDocument={(docId) => {
                setDocActionsAnchor(null);
                handleSelectDocument(docId);
              }}
              isActionsEnabled={Boolean(isAuthenticated && accessToken)}
              docActionsAnchor={docActionsAnchor}
              onToggleDocumentActions={handleToggleDocumentActions}
              resolveActionType={() => 'move-to-trash'}
              showAllButtonVisible={
                !isLoading &&
                documents.length > 0 &&
                (hasMore || documents.length > SIDEBAR_VISIBLE_COUNT)
              }
              onShowAll={openAllDocumentsPanel}
            />

            {isAuthenticated && (
              <SidebarDocumentSection
                title="Shared"
                className="mt-1"
                isOpen={isSharedOpen}
                onToggle={() => setIsSharedOpen((prev) => !prev)}
                documents={sharedDocuments}
                isLoading={isSharedLoading}
                emptyText="No shared documents"
                activeDocId={activeDocId}
                onSelectDocument={(docId) => {
                  setDocActionsAnchor(null);
                  handleSelectDocument(docId);
                }}
                isActionsEnabled={Boolean(isAuthenticated && accessToken)}
                docActionsAnchor={docActionsAnchor}
                onToggleDocumentActions={handleToggleDocumentActions}
                resolveActionType={resolveSharedActionType}
                showAllButtonVisible={
                  !isSharedLoading &&
                  sharedDocuments.length > 0 &&
                  (sharedHasMore || sharedDocuments.length > SIDEBAR_VISIBLE_COUNT)
                }
                onShowAll={openSharedDocumentsPanel}
              />
            )}
          </div>
        )}

        <div
          className={`relative mt-auto sticky bottom-0 ${isSidebarCollapsed ? '' : 'border-t border-border'} bg-sidebar p-2`}
        >
          <button
            ref={accountMenuTriggerRef}
            onClick={() => setIsAccountMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
            className="group/account w-full rounded-sm px-1.5 py-2 text-left transition-colors hover:bg-sidebar-accent cursor-pointer flex items-center overflow-hidden"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-[23px] w-[23px] flex-shrink-0 items-center justify-center rounded-full bg-[#7d7a75]"
            >
              {isAuthenticated && user ? (
                <span className="text-[11px] text-white font-semibold leading-none select-none">
                  {userInitial}
                </span>
              ) : (
                <UserCircle className="h-[15px] w-[15px]" />
              )}
            </span>
            <span
              className="flex items-center min-w-0 overflow-hidden transition-all duration-300"
              style={{
                opacity: isSidebarCollapsed ? 0 : 1,
                width: isSidebarCollapsed ? 0 : 'calc(100% - 23px)',
                paddingLeft: isSidebarCollapsed ? 0 : '12px',
              }}
            >
              <span className="truncate text-[14px] whitespace-nowrap flex-1">{accountLabel}</span>
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
            setIsAccountMenuOpen(false);
            setIsSettingsOpen(true);
          }}
          onOpenTrash={() => {
            setIsAccountMenuOpen(false);
            openTrashDocumentsPanel();
          }}
          onLogout={async () => {
            setIsAccountMenuOpen(false);
            await logout();
            await navigateToResolvedRootDocument({
              isAuthenticated: false,
              accessToken: null,
            });
          }}
          onOpenAuth={() => {
            setIsAccountMenuOpen(false);
            onOpenAuth();
          }}
          style={profileMenuStyle}
          popupRef={accountMenuPopupRef}
        />
      )}

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}

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
          isSidebarCollapsed={isSidebarCollapsed}
          sidebarWidth={sidebarWidth}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onClose={closeDocumentsPanel}
          isLoadingInitial={panelIsLoadingInitial}
          filteredDocuments={filteredDocuments}
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
          setDocActionsAnchor={setDocActionsAnchor}
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
            setPermanentDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmPermanentDelete();
        }}
      />

      {!isSidebarCollapsed && (
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-sidebar-border/80 active:bg-sidebar-ring z-50 transition-colors"
        />
      )}
    </aside>
  );
}

export default memo(Sidebar);
