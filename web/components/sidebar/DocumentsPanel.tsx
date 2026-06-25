import { useEffect, useRef } from 'react';
import { ChevronRight, Search, DocumentText, Restore, Trash } from '@/icons';
import { DocumentsPanelSkeleton } from './DocumentsPanelSkeleton';
import { DocumentActionsButton } from './DocumentActionsButton';
import type {
  DocumentsPanelMode,
  SidebarSectionDocument,
  DocActionsAnchor,
  DocActionType,
} from './types';

export type DocumentsPanelProps = {
  mode: NonNullable<DocumentsPanelMode>;
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onClose: () => void;
  isLoadingInitial: boolean;
  filteredDocuments: SidebarSectionDocument[];
  activeDocId: string;
  isAuthenticated: boolean;
  accessToken: string | null;
  trashActionLoadingDocId: string | null;
  isPermanentDeleteLoading: boolean;
  onSelectDocument: (id: string) => void;
  onRestoreFromTrash: (id: string) => Promise<void> | void;
  onRequestPermanentDelete: (id: string, title: string) => void;
  docActionsAnchor: DocActionsAnchor | null;
  onToggleDocumentActions: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
  resolvePanelActionType: (doc: SidebarSectionDocument) => DocActionType;
  setDocActionsAnchor: (anchor: DocActionsAnchor | null) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => Promise<void>;
};

export function DocumentsPanel({
  mode,
  isSidebarCollapsed,
  sidebarWidth,
  searchQuery,
  setSearchQuery,
  onClose,
  isLoadingInitial,
  filteredDocuments,
  activeDocId,
  isAuthenticated,
  accessToken,
  trashActionLoadingDocId,
  isPermanentDeleteLoading,
  onSelectDocument,
  onRestoreFromTrash,
  onRequestPermanentDelete,
  docActionsAnchor,
  onToggleDocumentActions,
  resolvePanelActionType,
  setDocActionsAnchor,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: DocumentsPanelProps) {
  const documentsPanelScrollRef = useRef<HTMLDivElement>(null);
  const documentsPanelSentinelRef = useRef<HTMLLIElement>(null);

  const isTrashPanel = mode === 'trash';
  const isSharedPanel = mode === 'shared';

  // Handle Escape key to close the panel
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Infinite scroll IntersectionObserver
  useEffect(() => {
    if (!hasMore || isLoadingInitial || isLoadingMore) {
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
        if (isIntersecting && !isLoadingMore) {
          void onLoadMore();
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
  }, [hasMore, isLoadingInitial, isLoadingMore, onLoadMore, filteredDocuments.length]);

  // Keep fetching pages while list does not fill the panel viewport yet
  useEffect(() => {
    if (!hasMore || isLoadingInitial || isLoadingMore) {
      return;
    }

    const container = documentsPanelScrollRef.current;
    if (!container) {
      return;
    }

    if (container.scrollHeight <= container.clientHeight + 24) {
      void onLoadMore();
    }
  }, [hasMore, isLoadingInitial, isLoadingMore, onLoadMore, filteredDocuments.length]);

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={
        isTrashPanel ? 'Trash documents' : isSharedPanel ? 'Shared documents' : 'Private documents'
      }
      className={`absolute inset-y-0 left-0 ${
        isSidebarCollapsed ? 'border-r border-sidebar-border' : ''
      } z-40 bg-sidebar flex flex-col animate-in slide-in-from-left-8 duration-300`}
      style={{
        width: isSidebarCollapsed ? `${sidebarWidth}px` : '100%',
      }}
    >
      <div className="px-2 pt-4 pb-3 border-b border-sidebar-border bg-gradient-to-b from-sidebar to-sidebar/95">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md pr-2 py-1 text-[12px] text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors cursor-pointer"
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
            className="w-full rounded-sm border border-sidebar-border bg-sidebar-accent/50 pl-9 pr-9 py-2 text-[13px] text-sidebar-foreground outline-none ring-0 focus:border-sidebar-ring focus:bg-sidebar"
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

      <div ref={documentsPanelScrollRef} className="flex-1 overflow-y-auto px-1.5 py-2">
        {isLoadingInitial ? (
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
          <ul className="flex flex-col gap-px">
            {filteredDocuments.map((doc) => {
              const isActive = doc.id === activeDocId;
              return (
                <li key={`all-doc-${doc.id}`} className="relative group/doc">
                  {isTrashPanel ? (
                    <div className="w-full relative group/doc" data-doc-actions-root={doc.id}>
                      <button
                        onClick={() => {
                          setDocActionsAnchor(null);
                          onSelectDocument(doc.id);
                        }}
                        className={`w-full flex items-center gap-2.5 px-2 pr-16 py-1.5 rounded-sm text-left transition-colors duration-100 cursor-pointer ${
                          isActive
                            ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent group-hover/doc:bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground'
                        }`}
                      >
                        <DocumentText size={16} className="flex-shrink-0 opacity-80" />
                        <span className="text-[13px] truncate">{doc.meta.title || 'Untitled'}</span>
                      </button>

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
                              void onRestoreFromTrash(doc.id);
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
                              onRequestPermanentDelete(doc.id, doc.meta.title || 'Untitled');
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
                          onSelectDocument(doc.id);
                        }}
                        className={`w-full flex items-center gap-2.5 px-2 pr-9 py-1.5 rounded-sm text-left transition-colors duration-100 cursor-pointer ${
                          isActive
                            ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent group-hover/doc:bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/doc:bg-sidebar-accent group-hover/doc:text-sidebar-foreground'
                        }`}
                      >
                        <DocumentText size={16} className="flex-shrink-0 opacity-80" />
                        <span className="text-[13px] truncate">{doc.meta.title || 'Untitled'}</span>
                      </button>

                      {isAuthenticated && accessToken && (
                        <DocumentActionsButton
                          documentId={doc.id}
                          documentTitle={doc.meta.title || 'Untitled'}
                          actionType={resolvePanelActionType(doc as SidebarSectionDocument)}
                          isOpen={docActionsAnchor?.documentId === doc.id}
                          onToggle={onToggleDocumentActions}
                        />
                      )}
                    </>
                  )}
                </li>
              );
            })}

            {isLoadingMore && (
              <li>
                <DocumentsPanelSkeleton rows={3} compact />
              </li>
            )}

            {hasMore && <li ref={documentsPanelSentinelRef} className="h-5 w-full" />}
          </ul>
        )}
      </div>
    </section>
  );
}
