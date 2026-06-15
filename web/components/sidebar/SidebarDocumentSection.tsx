import { ChevronRight, DocumentText, MoreHorizontal } from '@/icons';
import { DocumentActionsButton } from './DocumentActionsButton';
import { SIDEBAR_VISIBLE_COUNT } from './types';
import type { SidebarSectionDocument, DocActionsAnchor, DocActionType } from './types';

export type SidebarDocumentSectionProps = {
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

export function SidebarDocumentSection({
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
            <div className="flex flex-col gap-px px-0.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={`${title}-loading-${i}`}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-sm"
                >
                  <div className="h-4 w-4 flex-shrink-0 rounded-sm bg-sidebar-foreground/10 dark:bg-sidebar-foreground/15 animate-pulse" />
                  <div
                    className={`h-3 rounded-sm bg-sidebar-foreground/10 dark:bg-sidebar-foreground/15 animate-pulse ${
                      i === 1 ? 'w-[72%]' : i === 2 ? 'w-[58%]' : 'w-[66%]'
                    }`}
                  />
                </div>
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
                      className={`w-full flex items-center gap-2.5 px-2 pr-9 py-1.5 rounded-sm text-left transition-colors duration-100 cursor-pointer ${
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
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left transition-colors duration-100 cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
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
