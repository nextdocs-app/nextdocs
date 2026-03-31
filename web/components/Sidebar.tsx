'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  useLocalDocuments,
  type LocalDocumentEntry,
  type SharedDocumentEntry,
} from '@/hooks/useLocalDocuments.hook';
import { documentService } from '@/services/document.service';
import {
  NewDocument,
  Search,
  ChevronRight,
  DocumentText,
  Settings,
  Login,
  MoreHorizontal,
  Trash,
  Restore,
} from '@/icons';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { PopupMenuItem } from '@/components/PopupMenuItem';
import { SettingsModal } from '@/components/SettingsModal';
import { useTheme } from '@/hooks/useTheme.hook';
import { useAuth } from '@/hooks/useAuth.hook';

const emptySubscribe = () => () => {};
const SIDEBAR_VISIBLE_COUNT = 7;
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
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/70 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground cursor-pointer ${
        isOpen ? 'opacity-100' : 'opacity-0 group-hover/doc:opacity-100 focus-visible:opacity-100'
      }`}
      data-doc-actions-root={documentId}
    >
      <MoreHorizontal className="opacity-90" />
    </button>
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
        className="flex items-center gap-1 px-4 py-2 text-left text-[13px] text-muted-foreground cursor-pointer"
      >
        <span className="font-medium">{title}</span>
        <ChevronRight
          className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 ${isOpen ? 'rotate-90' : 'rotate-0'}`}
        />
      </button>

      {isOpen && (
        <nav className="px-2 pb-2">
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
            <div className="px-3 pt-1">
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
                      className={`w-full flex items-center gap-2.5 px-3 pr-9 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-pointer ${
                        isActive
                          ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent group-hover/doc:bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground'
                      }`}
                    >
                      <DocumentText className="flex-shrink-0 opacity-50" />
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
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <MoreHorizontal className="flex-shrink-0 opacity-80" />
                  <span className="text-[13px] truncate opacity-80">Show All Documents</span>
                </button>
              </li>
            </ul>
          )}
        </nav>
      )}
    </div>
  );
}

export default function Sidebar({ onOpenAuth }: { onOpenAuth: () => void }) {
  const router = useRouter();
  const params = useParams();
  const activeDocId = (params?.id as string) || 'default-doc';
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
  } = useLocalDocuments();
  const { resolvedTheme } = useTheme();
  const { user, isAuthenticated, accessToken, logout } = useAuth();
  const userInitial =
    user?.displayName?.trim()?.charAt(0)?.toUpperCase() ||
    user?.email?.charAt(0)?.toUpperCase() ||
    'U';

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
  const [searchQuery, setSearchQuery] = useState('');
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const documentsPanelScrollRef = useRef<HTMLDivElement>(null);
  const documentsPanelSentinelRef = useRef<HTMLLIElement>(null);

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
      let newId: string;

      if (isAuthenticated && accessToken) {
        const created = await documentService.createCloudDocument(accessToken);
        newId = created.id;
      } else {
        newId = crypto.randomUUID();
        const { ydoc, meta } = await documentService.createDocument();
        await documentService.saveDocument(newId, ydoc, meta);
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
      if (id === 'default-doc') {
        router.push('/');
      } else {
        router.push(`/doc/${id}`);
      }
    },
    [router]
  );

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
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
          router.push('/');
        }

        await refresh(false);
        await refreshTrash(false);
      } catch (error) {
        console.error('Failed to move document to trash:', error);
        alert('Failed to move document to trash. Please try again.');
      }
    },
    [isAuthenticated, accessToken, activeDocId, router, refresh, refreshTrash]
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
          router.push('/');
        }

        await refresh(false);
      } catch (error) {
        console.error('Failed to leave shared document:', error);
        alert('Failed to leave shared document. Please try again.');
      }
    },
    [isAuthenticated, accessToken, activeDocId, router, refresh]
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
        router.push('/');
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
    router,
    refresh,
    refreshTrash,
  ]);

  if (!isClient) {
    return <aside className="w-64 border-r flex-shrink-0 bg-sidebar" />;
  }

  return (
    <aside className="w-64 border-r flex-shrink-0 flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground border-border select-none">
      {/* Top actions */}
      <div className="flex flex-col gap-0.5 px-2 pt-3 pb-1">
        {/* New Document */}
        <button
          onClick={handleCreateFile}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                     text-sidebar-foreground hover:bg-sidebar-accent
                     transition-colors duration-100 cursor-pointer"
        >
          <NewDocument className="flex-shrink-0 opacity-80" />
          <span className="text-[14px]">New document</span>
        </button>

        {/* Search Documents (TODO: currently placeholder) */}
        <button
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                     text-sidebar-foreground hover:bg-sidebar-accent
                     transition-colors duration-100 cursor-pointer"
        >
          <Search className="flex-shrink-0 opacity-80" />
          <span className="text-[14px]">Search documents</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
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

        <div
          className="relative mt-auto sticky bottom-0 border-t border-border bg-sidebar p-2"
          ref={accountMenuRef}
        >
          {isAccountMenuOpen && (
            <div
              className={`absolute bottom-[calc(100%+0.35rem)] left-2 right-2 z-20 rounded-xl border border-sidebar-border
                       p-1.5 shadow-lg ${
                         resolvedTheme === 'dark'
                           ? 'bg-[#303030] text-white'
                           : 'bg-popover text-popover-foreground'
                       }`}
              role="menu"
              aria-label="Account options"
            >
              <PopupMenuItem
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                icon={<Settings size={16} className="opacity-90" />}
                onClick={() => {
                  setIsAccountMenuOpen(false);
                  setIsSettingsOpen(true);
                }}
              >
                Settings
              </PopupMenuItem>
              {isAuthenticated && (
                <PopupMenuItem
                  theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  icon={<Trash size={16} className="opacity-90" />}
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    openTrashDocumentsPanel();
                  }}
                >
                  Trash Documents
                </PopupMenuItem>
              )}
              {isAuthenticated ? (
                <PopupMenuItem
                  theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  icon={<Login size={16} className="opacity-90" />}
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    logout();
                  }}
                >
                  Log out
                </PopupMenuItem>
              ) : (
                <PopupMenuItem
                  theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  icon={<Login size={16} className="opacity-90" />}
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    onOpenAuth();
                  }}
                >
                  Log in
                </PopupMenuItem>
              )}
            </div>
          )}

          <button
            onClick={() => setIsAccountMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
            className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent cursor-pointer
                     flex items-center justify-between gap-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-foreground/70 flex-shrink-0"
              >
                {isAuthenticated && user ? (
                  <span className="text-[11px] font-semibold leading-none select-none">
                    {userInitial}
                  </span>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <circle cx="12" cy="8" r="3.25" />
                    <path d="M5.5 18.25a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <span className="truncate text-[14px]">
                {isAuthenticated && user ? user.displayName : 'Guest User'}
              </span>
            </span>
            <ChevronRight
              className={`flex-shrink-0 opacity-70 transition-transform duration-150 ${
                isAccountMenuOpen ? '-rotate-90' : 'rotate-90'
              }`}
            />
          </button>
        </div>
      </div>
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
                <Login size={16} className="opacity-90" />
              ) : (
                <Trash size={16} className="opacity-90" />
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

            <div ref={documentsPanelScrollRef} className="flex-1 overflow-y-auto px-3 py-3">
              {panelIsLoadingInitial ? (
                <ul className="flex flex-col gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <li key={`panel-initial-loading-${i}`}>
                      <div className="h-12 rounded-xl bg-sidebar-accent/35 animate-pulse" />
                    </li>
                  ))}
                </ul>
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
                            <div className="w-full flex items-center gap-2.5 px-3 pr-16 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-default text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground">
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
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
                              className={`w-full flex items-center gap-2.5 px-3 pr-9 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-pointer ${
                                isActive
                                  ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent group-hover/doc:bg-sidebar-accent text-sidebar-accent-foreground'
                                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground'
                              }`}
                            >
                              <DocumentText className="flex-shrink-0 opacity-50" />
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
                    <>
                      {[1, 2, 3].map((i) => (
                        <li key={`all-doc-loading-${i}`}>
                          <div className="h-12 rounded-xl bg-sidebar-accent/35 animate-pulse" />
                        </li>
                      ))}
                    </>
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
