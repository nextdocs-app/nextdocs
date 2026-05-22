'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { memo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  useDocumentList,
  type LocalDocumentEntry,
  type SharedDocumentEntry,
} from '@/hooks/useDocumentList.hook';
import { documentService } from '@/services/document.service';
import {
  NewDocument,
  Search,
  ChevronRight,
  DocumentText,
  Settings,
  Login,
  Logout,
  MoreHorizontal,
  Trash,
  Restore,
  NextDocs,
  CloseSidebar,
  OpenSidebar,
} from '@/icons';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { PopupMenuItem } from '@/components/PopupMenuItem';
import { SettingsModal } from '@/components/SettingsModal';
import { useTheme } from '@/hooks/useTheme.hook';
import { useAuth } from '@/hooks/useAuth.hook';
import { useOfflineDocumentSelect } from '@/hooks/useOfflineDocumentSelect.hook';
import { generateDocumentId } from '@/lib/document-id.util';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '@/lib/offline-navigation.util';
import { resolveRootDocumentId } from '@/lib/root-document.util';

const emptySubscribe = () => () => {};
const SIDEBAR_VISIBLE_COUNT = 7;
const SIDEBAR_COLLAPSE_HOVER_GUARD_MS = 260;
type DocumentsPanelMode = 'all' | 'shared' | 'trash' | null;
type DocActionType = 'move-to-trash' | 'leave-shared';
type DocActionsAnchor = {
  documentId: string;
  actionType: DocActionType;
  x: number;
  y: number;
};
type SidebarSectionDocument = LocalDocumentEntry | SharedDocumentEntry;

type DocumentActionsButtonProps = {
  documentId: string;
  documentTitle: string;
  actionType: DocActionType;
  isOpen: boolean;
  onToggle: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
};

function DocumentActionsButton({
  documentId,
  documentTitle,
  actionType,
  isOpen,
  onToggle,
}: DocumentActionsButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Document actions for ${documentTitle || 'Untitled'}`}
      onClick={(event) => onToggle(event, documentId, actionType)}
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/80 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground cursor-pointer ${
        isOpen ? 'opacity-100' : 'opacity-0 group-hover/doc:opacity-100 focus-visible:opacity-100'
      }`}
      data-doc-actions-root={documentId}
    >
      <MoreHorizontal className="opacity-80" />
    </button>
  );
}

function DocumentsPanelSkeleton({
  rows = 6,
  compact = false,
}: {
  rows?: number;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col ${compact ? 'gap-2 py-2' : 'gap-2.5 py-1'}`}
      data-testid={compact ? 'documents-panel-loading-more-skeleton' : 'documents-panel-skeleton'}
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={`documents-panel-skeleton-${compact ? 'compact' : 'default'}-${index + 1}`}
          className={`rounded-xl border border-sidebar-border/60 bg-sidebar-accent/20 ${
            compact ? 'px-2 py-2.5' : 'px-2 py-3'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 flex-shrink-0 rounded bg-sidebar-accent/55 animate-pulse" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div
                className={`h-3 rounded bg-sidebar-accent/55 animate-pulse ${
                  index % 3 === 0 ? 'w-[72%]' : index % 3 === 1 ? 'w-[58%]' : 'w-[66%]'
                }`}
              />
              {!compact && (
                <div
                  className={`h-2.5 rounded bg-sidebar-accent/40 animate-pulse ${
                    index % 2 === 0 ? 'w-[34%]' : 'w-[28%]'
                  }`}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type SidebarDocumentSectionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  documents: SidebarSectionDocument[];
  isLoading: boolean;
  emptyText: string;
  activeDocId: string;
  onSelectDocument: (id: string) => void;
  isActionsEnabled: boolean;
  docActionsAnchor: DocActionsAnchor | null;
  onToggleDocumentActions: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
  resolveActionType: (doc: SidebarSectionDocument) => DocActionType;
  showAllButtonVisible: boolean;
  onShowAll: () => void;
  className?: string;
};

function SidebarDocumentSection({
  title,
  isOpen,
  onToggle,
  documents,
  isLoading,
  emptyText,
  activeDocId,
  onSelectDocument,
  isActionsEnabled,
  docActionsAnchor,
  onToggleDocumentActions,
  resolveActionType,
  showAllButtonVisible,
  onShowAll,
  className,
}: SidebarDocumentSectionProps) {
  const visibleDocuments = documents.slice(0, SIDEBAR_VISIBLE_COUNT);

  return (
    <div className={`group flex flex-col ${className ?? ''}`.trim()}>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex items-center gap-1 px-3 py-2 text-left text-[13px] text-muted-foreground cursor-pointer"
      >
        <span className="font-medium">{title}</span>
        <ChevronRight
          className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 ${isOpen ? 'rotate-90' : 'rotate-0'}`}
        />
      </button>

      {isOpen && (
        <nav className="px-1.5 pb-2">
          {isLoading ? (
            <div className="flex flex-col gap-0.5 px-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={`${title}-loading-${i}`}
                  className="h-8 rounded-lg bg-sidebar-accent/30 animate-pulse"
                />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="px-2 pt-1">
              <p className="text-[13px] text-muted-foreground/50">{emptyText}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-px">
              {visibleDocuments.map((doc) => {
                const isActive = doc.id === activeDocId;
                const actionType = resolveActionType(doc);

                return (
                  <li
                    key={`${title}-${doc.id}`}
                    className="relative group/doc"
                    data-doc-actions-root={doc.id}
                  >
                    <button
                      onClick={() => onSelectDocument(doc.id)}
                      className={`w-full flex items-center gap-2.5 px-2 pr-9 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-pointer ${
                        isActive
                          ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent group-hover/doc:bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground'
                      }`}
                    >
                      <DocumentText size={16} className="flex-shrink-0 opacity-80" />
                      <span className="text-[13px] truncate">{doc.meta.title || 'Untitled'}</span>
                    </button>

                    {isActionsEnabled && (
                      <DocumentActionsButton
                        documentId={doc.id}
                        documentTitle={doc.meta.title || 'Untitled'}
                        actionType={actionType}
                        isOpen={docActionsAnchor?.documentId === doc.id}
                        onToggle={onToggleDocumentActions}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {showAllButtonVisible && (
            <ul className="flex flex-col gap-px">
              <li>
                <button
                  type="button"
                  onClick={onShowAll}
                  aria-label={`Show all ${title.toLowerCase()} documents`}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
                >
                  <MoreHorizontal className="flex-shrink-0" />
                  <span className="text-[13px] truncate">Show More</span>
                </button>
              </li>
            </ul>
          )}
        </nav>
      )}
    </div>
  );
}

type ProfileMenuPopupProps = {
  theme: 'dark' | 'light';
  isAuthenticated: boolean;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  onLogout: () => void;
  onOpenAuth: () => void;
  style: React.CSSProperties;
  popupRef: React.RefObject<HTMLDivElement | null>;
};

function ProfileMenuPopup({
  theme,
  isAuthenticated,
  onOpenSettings,
  onOpenTrash,
  onLogout,
  onOpenAuth,
  style,
  popupRef,
}: ProfileMenuPopupProps) {
  return (
    <div
      ref={popupRef}
      style={style}
      className={`fixed w-[14.3rem] text-[14px] z-30 rounded-xl border border-sidebar-border p-1.5 shadow-lg ${
        theme === 'dark' ? 'bg-[#303030] text-white' : 'bg-popover text-popover-foreground'
      }`}
      role="menu"
      aria-label="Account options"
    >
      <PopupMenuItem
        theme={theme}
        icon={<Settings size={15} className="opacity-90" />}
        onClick={onOpenSettings}
      >
        Settings
      </PopupMenuItem>
      {isAuthenticated && (
        <PopupMenuItem
          theme={theme}
          icon={<Trash size={15} className="opacity-90" />}
          onClick={onOpenTrash}
        >
          Trash Documents
        </PopupMenuItem>
      )}
      {isAuthenticated ? (
        <PopupMenuItem
          theme={theme}
          icon={<Logout size={15} className="opacity-90" />}
          onClick={onLogout}
        >
          Log out
        </PopupMenuItem>
      ) : (
        <PopupMenuItem theme={theme} icon={<Login className="opacity-90" />} onClick={onOpenAuth}>
          Log in
        </PopupMenuItem>
      )}
    </div>
  );
}

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
  const documentsPanelScrollRef = useRef<HTMLDivElement>(null);
  const documentsPanelSentinelRef = useRef<HTMLLIElement>(null);

  const isDocumentsPanelOpen = documentsPanelMode !== null;
  const isTrashPanel = documentsPanelMode === 'trash';
  const isSharedPanel = documentsPanelMode === 'shared';
  const profileMenuStyle = { left: '0.75rem', bottom: '4.25rem' } as React.CSSProperties;

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

  useEffect(() => {
    if (!isDocumentsPanelOpen || !panelHasMore || panelIsLoadingInitial || panelIsLoadingMore) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const root = documentsPanelScrollRef.current;
    const target = documentsPanelSentinelRef.current;
    if (!root || !target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting);
        if (isIntersecting && !panelIsLoadingMore) {
          if (isTrashPanel) {
            void loadMoreTrashDocuments();
          } else if (isSharedPanel) {
            void loadMoreSharedDocuments();
          } else {
            void loadMore();
          }
        }
      },
      {
        root,
        rootMargin: '120px',
        threshold: 0.1,
      }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [
    isDocumentsPanelOpen,
    panelHasMore,
    panelIsLoadingInitial,
    panelIsLoadingMore,
    isTrashPanel,
    isSharedPanel,
    loadMore,
    loadMoreSharedDocuments,
    loadMoreTrashDocuments,
    filteredDocuments.length,
  ]);

  useEffect(() => {
    if (!isDocumentsPanelOpen || !panelHasMore || panelIsLoadingInitial || panelIsLoadingMore) {
      return;
    }

    const container = documentsPanelScrollRef.current;
    if (!container) {
      return;
    }

    // Keep fetching pages while list does not fill the panel viewport yet.
    if (container.scrollHeight <= container.clientHeight + 24) {
      if (isTrashPanel) {
        void loadMoreTrashDocuments();
      } else if (isSharedPanel) {
        void loadMoreSharedDocuments();
      } else {
        void loadMore();
      }
    }
  }, [
    isDocumentsPanelOpen,
    panelHasMore,
    panelIsLoadingInitial,
    panelIsLoadingMore,
    isTrashPanel,
    isSharedPanel,
    loadMore,
    loadMoreSharedDocuments,
    loadMoreTrashDocuments,
    filteredDocuments.length,
  ]);

  useEffect(() => {
    if (!isDocumentsPanelOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDocumentsPanelMode(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isDocumentsPanelOpen]);

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
      className={`${isSidebarCollapsed ? 'w-13 border-r-0' : 'w-64 border-r'} border-sidebar-border flex-shrink-0 flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground select-none transition-all duration-300`}
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
            className={`flex items-center gap-3 px-2 py-2 rounded-lg text-sidebar-foreground/80 transition-colors duration-100 cursor-pointer overflow-hidden ${
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
          <div className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer overflow-hidden">
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
            className="inline-flex px-2 py-2 items-center justify-center rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-100 cursor-pointer flex-shrink-0"
          >
            <CloseSidebar size={20} className="flex-shrink-0 opacity-80" />
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col py-2 px-2">
        <button
          onClick={handleCreateFile}
          className="flex items-center gap-3 px-2 py-[7px] rounded-lg text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer overflow-hidden"
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
          className="flex items-center gap-3 px-2 py-[7px] rounded-lg text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-100 cursor-pointer overflow-hidden"
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
            className="group/account w-full rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-sidebar-accent cursor-pointer flex items-center overflow-hidden"
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
                <svg
                  viewBox="0 0 24 24"
                  className="h-[15px] w-[15px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="12" cy="8" r="3.25" />
                  <path d="M5.5 18.25a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
                </svg>
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
        <div
          data-doc-actions-root={docActionsAnchor.documentId}
          style={{ left: docActionsAnchor.x, top: docActionsAnchor.y }}
          className={`fixed z-50 min-w-[11.5rem] -translate-y-1/2 rounded-lg border border-sidebar-border p-1.5 shadow-xl ${
            resolvedTheme === 'dark'
              ? 'bg-[#303030] text-white'
              : 'bg-popover text-popover-foreground'
          }`}
          role="menu"
          aria-label="Document actions"
        >
          <PopupMenuItem
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            icon={
              docActionsAnchor.actionType === 'leave-shared' ? (
                <Logout className="opacity-90" />
              ) : (
                <Trash size={15} className="opacity-90" />
              )
            }
            onClick={(event) => {
              event.stopPropagation();
              if (docActionsAnchor.actionType === 'leave-shared') {
                void handleLeaveSharedDocument(docActionsAnchor.documentId);
                return;
              }

              void handleMoveToTrash(docActionsAnchor.documentId);
            }}
            className={
              resolvedTheme === 'dark'
                ? 'text-white/90 hover:text-red-400'
                : 'text-popover-foreground hover:text-red-600'
            }
          >
            {docActionsAnchor.actionType === 'leave-shared'
              ? 'Leave shared document'
              : 'Move to Trash'}
          </PopupMenuItem>
        </div>
      )}

      {isDocumentsPanelOpen && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close documents panel"
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
            onClick={closeDocumentsPanel}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              isTrashPanel
                ? 'Trash documents'
                : isSharedPanel
                  ? 'Shared documents'
                  : 'Private documents'
            }
            className="absolute inset-y-0 left-0 w-full max-w-[22rem] border-r border-sidebar-border bg-sidebar shadow-2xl flex flex-col animate-in slide-in-from-left-8 duration-300"
          >
            <div className="px-4 pt-4 pb-3 border-b border-sidebar-border bg-gradient-to-b from-sidebar to-sidebar/95">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeDocumentsPanel}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors cursor-pointer"
                >
                  <ChevronRight className="rotate-180 opacity-80" />
                  Back
                </button>
                <h2 className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
                  {isTrashPanel ? 'Trash' : isSharedPanel ? 'Shared' : 'Private'}
                </h2>
              </div>

              <div className="mt-3 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-55" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={isTrashPanel ? 'Search trash' : 'Search documents'}
                  className="w-full rounded-lg border border-sidebar-border bg-sidebar-accent/50 pl-9 pr-9 py-2 text-[13px] text-sidebar-foreground outline-none ring-0 focus:border-sidebar-ring focus:bg-sidebar"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div ref={documentsPanelScrollRef} className="flex-1 overflow-y-auto px-2 py-3">
              {panelIsLoadingInitial ? (
                <DocumentsPanelSkeleton rows={6} />
              ) : filteredDocuments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sidebar-border px-4 py-8 text-center bg-sidebar-accent/20">
                  <p className="text-[13px] text-muted-foreground">
                    {searchQuery
                      ? 'No documents match your search.'
                      : isTrashPanel
                        ? 'No documents in trash.'
                        : isSharedPanel
                          ? 'No shared documents yet.'
                          : 'No documents yet.'}
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {filteredDocuments.map((doc) => {
                    const isActive = doc.id === activeDocId;
                    return (
                      <li key={`all-doc-${doc.id}`} className="relative group/doc">
                        {isTrashPanel ? (
                          <div className="w-full relative group/doc" data-doc-actions-root={doc.id}>
                            <div className="w-full flex items-center gap-2.5 px-2 pr-16 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-default text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground">
                              <DocumentText className="flex-shrink-0 opacity-50" />
                              <span className="text-[13px] truncate">
                                {doc.meta.title || 'Untitled'}
                              </span>
                            </div>

                            {isAuthenticated && accessToken && (
                              <div
                                className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-opacity ${
                                  trashActionLoadingDocId === doc.id
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover/doc:opacity-100'
                                }`}
                              >
                                <button
                                  type="button"
                                  aria-label={`Restore ${doc.meta.title || 'Untitled'}`}
                                  disabled={
                                    trashActionLoadingDocId === doc.id || isPermanentDeleteLoading
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleRestoreFromTrash(doc.id);
                                  }}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  <Restore className="opacity-90" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Delete permanently ${doc.meta.title || 'Untitled'}`}
                                  disabled={
                                    trashActionLoadingDocId === doc.id || isPermanentDeleteLoading
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleRequestPermanentDelete(
                                      doc.id,
                                      doc.meta.title || 'Untitled'
                                    );
                                  }}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  <Trash className="opacity-90" />
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setDocActionsAnchor(null);
                                handleSelectDocument(doc.id);
                                closeDocumentsPanel();
                              }}
                              className={`w-full flex items-center gap-2.5 px-2 pr-9 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-pointer ${
                                isActive
                                  ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent group-hover/doc:bg-sidebar-accent text-sidebar-accent-foreground'
                                  : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground'
                              }`}
                            >
                              <DocumentText className="flex-shrink-0 size-4 opacity-80" />
                              <span className="text-[13px] truncate">
                                {doc.meta.title || 'Untitled'}
                              </span>
                            </button>

                            {isAuthenticated && accessToken && (
                              <DocumentActionsButton
                                documentId={doc.id}
                                documentTitle={doc.meta.title || 'Untitled'}
                                actionType={resolvePanelActionType(doc as SidebarSectionDocument)}
                                isOpen={docActionsAnchor?.documentId === doc.id}
                                onToggle={handleToggleDocumentActions}
                              />
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}

                  {panelIsLoadingMore && (
                    <li>
                      <DocumentsPanelSkeleton rows={3} compact />
                    </li>
                  )}

                  {panelHasMore && <li ref={documentsPanelSentinelRef} className="h-5 w-full" />}
                </ul>
              )}
            </div>
          </section>
        </div>
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
    </aside>
  );
}

export default memo(Sidebar);
