'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SharePanel } from '@/components/SharePanel';
import { Comments, Globe, MoreHorizontal } from '@/icons/index';
import { useAppSelector } from '@/stores/hooks';
import { useDocumentBreadcrumbs } from '@/hooks/useDocumentBreadcrumbs.hook';
import { OFFLINE_DOCUMENT_SELECT_EVENT } from '@/lib/offline-navigation.util';
import type { DocumentBreadcrumbItem } from '@/services/document.service';

function formatLastEdited(dateStr: string | undefined | null): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 30) return 'Edited just now';
  if (diffMin < 1) return 'Edited seconds ago';
  if (diffMin === 1) return 'Edited 1 min ago';
  if (diffMin < 60) return `Edited ${diffMin} mins ago`;
  if (diffHr === 1) return 'Edited 1 hour ago';
  if (diffHr < 24) return `Edited ${diffHr} hours ago`;
  if (diffDay === 1) return 'Edited yesterday';

  return `Edited ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

interface DocToolbarProps {
  /** documentId used for share panel and hierarchy */
  documentId: string;
  /** Current document title for live breadcrumb updates */
  documentTitle?: string;
  /** Current document icon (reserved for future icon/cover support) */
  documentIcon?: string | null;
  /** Optional navigation callback */
  onNavigateDocument?: (id: string) => void;
  /** Whether the authenticated user can open the share panel */
  isShareEnabled: boolean;
  /** ISO string of when the document was last edited */
  updatedAt?: string | null;
  /** Whether the browser is offline and edits may need local sync fallback */
  isOffline: boolean;
  /** Number of local edits pending sync (shown in offline tooltip) */
  pendingEdits?: number;
  /** Whether to show the comments sidebar toggle button */
  showCommentsButton?: boolean;
  /** Whether the comments sidebar is currently open */
  isCommentsSidebarOpen?: boolean;
  /** Number of currently open threads */
  openCommentsCount?: number;
  /** Callback to toggle the comments sidebar */
  onCommentsToggle?: () => void;
  /** Whether to show a guest-access notice in the top toolbar */
  showGuestNotice?: boolean;
  /** Callback for the guest notice auth CTA */
  onGuestNoticeCtaClick?: () => void;
  /** Whether to show a trash notice in the top toolbar */
  showTrashNotice?: boolean;
  /** Whether the viewer may restore/purge the trashed document (EDIT access or owner) */
  canManageTrash?: boolean;
  /** Callback to restore the document from trash */
  onRestore?: () => void;
}

export function DocToolbar({
  documentId,
  documentTitle,
  documentIcon,
  onNavigateDocument,
  isShareEnabled,
  updatedAt,
  isOffline,
  pendingEdits = 0,
  showCommentsButton = false,
  isCommentsSidebarOpen = false,
  openCommentsCount = 0,
  onCommentsToggle,
  showGuestNotice = false,
  onGuestNoticeCtaClick,
  showTrashNotice = false,
  canManageTrash = false,
  onRestore,
}: DocToolbarProps) {
  const router = useRouter();
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [showOfflineTooltip, setShowOfflineTooltip] = useState(false);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  const isSidebarCollapsed = useAppSelector((state) => state?.sidebar?.isCollapsed ?? false);

  // Hook to get full document hierarchy (reactive to live title edits and tree updates)
  const { breadcrumbs } = useDocumentBreadcrumbs(documentId, documentTitle, documentIcon);

  const handleShareToggle = useCallback(() => {
    setIsShareOpen((prev) => !prev);
  }, []);

  const handleNavigate = useCallback(
    (targetId: string) => {
      if (targetId === documentId) return;
      setIsOverflowMenuOpen(false);

      if (onNavigateDocument) {
        onNavigateDocument(targetId);
        return;
      }

      if (isOffline || (typeof window !== 'undefined' && !navigator.onLine)) {
        window.dispatchEvent(
          new CustomEvent(OFFLINE_DOCUMENT_SELECT_EVENT, {
            detail: { id: targetId },
          })
        );
        return;
      }

      router.push(`/doc/${targetId}`);
    },
    [documentId, onNavigateDocument, isOffline, router]
  );

  // Close overflow dropdown on outside click or escape
  useEffect(() => {
    if (!isOverflowMenuOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        setIsOverflowMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOverflowMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOverflowMenuOpen]);

  const lastEditedLabel = formatLastEdited(updatedAt);
  const offlineTooltipId = 'doc-offline-tooltip';
  const offlineTooltipText =
    pendingEdits > 0
      ? `${pendingEdits} edit${pendingEdits === 1 ? '' : 's'} pending sync`
      : 'No local edits pending sync';
  const isCommentsButtonDisabled = !onCommentsToggle;
  const commentsSummary =
    openCommentsCount > 0
      ? `${openCommentsCount} open thread${openCommentsCount === 1 ? '' : 's'}`
      : 'No open threads';
  const shouldShowGuestNotice = showGuestNotice && !!onGuestNoticeCtaClick;
  const isOfflineTooltipOpen = isOffline && showOfflineTooltip;

  // Breadcrumbs rendering:
  // When hierarchy is > 3 levels: [First Root] / [...] / [Immediate Parent] / [Current Doc]
  const shouldCollapseBreadcrumbs = breadcrumbs.length > 3;
  const rootItem = shouldCollapseBreadcrumbs ? breadcrumbs[0] : null;
  const intermediateItems = shouldCollapseBreadcrumbs ? breadcrumbs.slice(1, -2) : [];
  const parentItem = shouldCollapseBreadcrumbs ? breadcrumbs[breadcrumbs.length - 2] : null;
  const currentItem =
    breadcrumbs.length > 0
      ? breadcrumbs[breadcrumbs.length - 1]
      : { id: documentId, title: documentTitle || 'Untitled' };

  // Left offset tracking: aligns pixel-perfectly with left sidebar edge
  const leftPositionStyle = {
    left: isSidebarCollapsed
      ? 'calc(3.25rem + 12px)'
      : 'calc(var(--nd-sidebar-width, 256px) + 12px)',
  };

  return (
    <>
      {/* ── Left most toolbar: Document Hierarchy Breadcrumbs (Notion-style) ── */}
      <div
        className="
          nd-doc-toolbar-left fixed top-2 z-40
          flex items-center gap-0.5 min-w-0
          max-w-[calc(100vw-var(--nd-sidebar-width,256px)-260px)]
          h-7 select-none pointer-events-auto
          transition-[left] duration-300
        "
        style={leftPositionStyle}
        role="navigation"
        aria-label="Document hierarchy"
      >
        {/*
          Note: Document icon and cover image are not yet introduced into the entity model.
          For now, we display document titles only in the hierarchy breadcrumbs.
          When the icon/cover feature is introduced in the future, icons can be rendered here directly alongside titles.
        */}
        {shouldCollapseBreadcrumbs ? (
          <>
            {/* Root Document */}
            {rootItem && (
              <button
                type="button"
                onClick={() => handleNavigate(rootItem.id)}
                title={`Open "${rootItem.title || 'Untitled'}"`}
                aria-label={`Open "${rootItem.title || 'Untitled'}"`}
                className="
                  group/crumb inline-flex items-center rounded-sm px-1.5 py-0.5
                  text-[13px] font-normal leading-normal text-muted-foreground
                  hover:text-foreground hover:bg-[var(--nd-toolbar-hover-bg)]
                  transition-colors duration-150 max-w-[130px] sm:max-w-[170px]
                  cursor-pointer shrink-0
                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
                "
              >
                <span className="truncate leading-normal">{rootItem.title || 'Untitled'}</span>
              </button>
            )}

            <span
              className="text-muted-foreground/35 select-none text-[12px] font-light px-0.5 shrink-0"
              aria-hidden="true"
            >
              /
            </span>

            {/* Collapsed Ellipsis with Dropdown */}
            <div className="relative inline-flex items-center shrink-0" ref={overflowMenuRef}>
              <button
                type="button"
                onClick={() => setIsOverflowMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={isOverflowMenuOpen}
                aria-label="Show intermediate parent documents"
                title="Show intermediate parent documents"
                className="
                  inline-flex items-center justify-center rounded-sm px-1 py-1
                  text-muted-foreground hover:text-foreground hover:bg-[var(--nd-toolbar-hover-bg)]
                  transition-colors duration-150 cursor-pointer shrink-0
                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
                "
              >
                <MoreHorizontal size={15} className="opacity-80" />
              </button>

              {isOverflowMenuOpen && (
                <div
                  role="menu"
                  className="
                    absolute top-full left-0 mt-1.5 min-w-[180px] max-w-[260px]
                    rounded-md border border-border/80 bg-popover p-1 shadow-md
                    z-50 animate-in fade-in duration-100
                  "
                >
                  {intermediateItems.map((item: DocumentBreadcrumbItem) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => handleNavigate(item.id)}
                      title={`Open "${item.title || 'Untitled'}"`}
                      aria-label={`Open "${item.title || 'Untitled'}"`}
                      className="
                        w-full rounded-sm px-2 py-1.5 text-left text-[12.5px] leading-normal
                        text-popover-foreground hover:bg-accent hover:text-accent-foreground
                        transition-colors flex items-center gap-1.5 cursor-pointer
                      "
                    >
                      <span className="truncate leading-normal">{item.title || 'Untitled'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span
              className="text-muted-foreground/35 select-none text-[12px] font-light px-0.5 shrink-0"
              aria-hidden="true"
            >
              /
            </span>

            {/* Immediate Parent Document */}
            {parentItem && (
              <button
                type="button"
                onClick={() => handleNavigate(parentItem.id)}
                title={`Open "${parentItem.title || 'Untitled'}"`}
                aria-label={`Open "${parentItem.title || 'Untitled'}"`}
                className="
                  group/crumb inline-flex items-center rounded-sm px-1.5 py-0.5
                  text-[13px] font-normal leading-normal text-muted-foreground
                  hover:text-foreground hover:bg-[var(--nd-toolbar-hover-bg)]
                  transition-colors duration-150 max-w-[130px] sm:max-w-[170px]
                  cursor-pointer shrink-0
                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
                "
              >
                <span className="truncate leading-normal">{parentItem.title || 'Untitled'}</span>
              </button>
            )}

            <span
              className="text-muted-foreground/35 select-none text-[12px] font-light px-0.5 shrink-0"
              aria-hidden="true"
            >
              /
            </span>

            {/* Current Active Document */}
            <span
              aria-current="page"
              className="
                inline-flex items-center rounded-sm px-1.5 py-0.5
                text-[13px] font-medium leading-normal text-foreground
                max-w-[160px] sm:max-w-[220px] md:max-w-[280px]
                shrink-0 select-none
              "
            >
              <span className="truncate leading-normal">{currentItem.title || 'Untitled'}</span>
            </span>
          </>
        ) : (
          breadcrumbs.map((item, index) => {
            const isCurrent = index === breadcrumbs.length - 1;
            return (
              <span key={item.id} className="inline-flex items-center min-w-0 shrink-0">
                {isCurrent ? (
                  <span
                    aria-current="page"
                    className="
                      inline-flex items-center rounded-sm px-1.5 py-0.5
                      text-[13px] font-medium leading-normal text-foreground
                      max-w-[160px] sm:max-w-[220px] md:max-w-[280px]
                      shrink-0 select-none
                    "
                  >
                    <span className="truncate leading-normal">{item.title || 'Untitled'}</span>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleNavigate(item.id)}
                      title={`Open "${item.title || 'Untitled'}"`}
                      aria-label={`Open "${item.title || 'Untitled'}"`}
                      className="
                        group/crumb inline-flex items-center rounded-sm px-1.5 py-0.5
                        text-[13px] font-normal leading-normal text-muted-foreground
                        hover:text-foreground hover:bg-[var(--nd-toolbar-hover-bg)]
                        transition-colors duration-150 max-w-[130px] sm:max-w-[170px]
                        cursor-pointer shrink-0
                        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
                      "
                    >
                      <span className="truncate leading-normal">{item.title || 'Untitled'}</span>
                    </button>
                    <span
                      className="text-muted-foreground/35 select-none text-[12px] font-light px-0.5 shrink-0"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  </>
                )}
              </span>
            );
          })
        )}

        {/* ── Offline badge ── */}
        {isOffline && (
          <div
            className="relative inline-flex items-center ml-1.5 pointer-events-auto shrink-0"
            role="button"
            tabIndex={0}
            aria-label="Offline sync status"
            aria-expanded={isOfflineTooltipOpen}
            aria-describedby={isOfflineTooltipOpen ? offlineTooltipId : undefined}
            onMouseEnter={() => setShowOfflineTooltip(true)}
            onMouseLeave={() => setShowOfflineTooltip(false)}
            onFocus={() => setShowOfflineTooltip(true)}
            onBlur={() => setShowOfflineTooltip(false)}
            onClick={() => setShowOfflineTooltip((prev) => !prev)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setShowOfflineTooltip(true);
              }
              if (event.key === 'Escape') {
                setShowOfflineTooltip(false);
              }
            }}
          >
            <div
              className="
                inline-flex items-center gap-1.5 rounded-full
                border border-border/60 bg-background/80 backdrop-blur-sm
                px-2 py-0.5
                text-[11px] text-muted-foreground
                select-none cursor-default
                transition-colors duration-150
                hover:bg-[var(--nd-toolbar-hover-bg)]
              "
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
                aria-hidden="true"
              />
              Offline
            </div>

            {isOfflineTooltipOpen && (
              <div
                id={offlineTooltipId}
                role="tooltip"
                className="
                  absolute top-full mt-1.5 left-0
                  rounded-lg border border-border/60
                  bg-background shadow-lg shadow-black/10
                  px-3 py-2.5
                  whitespace-nowrap
                  pointer-events-none
                  animate-in fade-in duration-100
                  z-50
                "
              >
                <div className="text-[11px] font-medium text-foreground">Offline changes</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{offlineTooltipText}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Top-right toolbar ── */}
      <div className="nd-doc-toolbar fixed top-2 right-2 z-40 flex items-center gap-1.5 h-7">
        {showTrashNotice && canManageTrash && (
          <div
            className="
              inline-flex items-center gap-1.5 rounded-lg
              border border-border/70 bg-background/85 backdrop-blur-sm
              px-3 py-1
              text-[12px] text-muted-foreground
              shadow-sm
              whitespace-nowrap
            "
          >
            <span>This document is in the trash.</span>
            {onRestore && (
              <>
                <button
                  type="button"
                  onClick={onRestore}
                  className="
                    rounded-sm px-0.5
                    font-medium text-foreground
                    underline decoration-foreground/30 underline-offset-3
                    hover:text-primary hover:decoration-primary/60
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50
                    transition-colors cursor-pointer
                  "
                >
                  Restore
                </button>
                <span>it to make edits.</span>
              </>
            )}
          </div>
        )}

        {showTrashNotice && !canManageTrash && (
          <div
            className="
              inline-flex items-center gap-1.5 rounded-lg
              border border-border/70 bg-background/85 backdrop-blur-sm
              px-3 py-1
              text-[12px] text-muted-foreground
              shadow-sm
              whitespace-nowrap
            "
          >
            <span>
              This document is in the owner&apos;s trash. You have read-only access and can view it,
              but only people with edit access can restore or delete it.
            </span>
          </div>
        )}

        {shouldShowGuestNotice && (
          <div
            className="
              inline-flex items-center gap-1.5 rounded-lg
              border border-border/70 bg-background/85 backdrop-blur-sm
              px-3 py-1
              text-[12px] text-muted-foreground
              shadow-sm
              whitespace-nowrap
            "
          >
            <span>You are viewing this shared document as a guest.</span>
            <button
              type="button"
              onClick={() => onGuestNoticeCtaClick?.()}
              className="
                rounded-sm px-0.5
                font-medium text-foreground
                underline decoration-foreground/30 underline-offset-3
                hover:text-primary hover:decoration-primary/60
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50
                transition-colors cursor-pointer
              "
            >
              Sign up or log in
            </button>
            <span className="hidden lg:inline">to get full access to this document.</span>
          </div>
        )}

        {/* Last edited */}
        {lastEditedLabel && (
          <span className="text-[12.5px] text-muted-foreground/80 select-none hidden sm:block">
            {lastEditedLabel}
          </span>
        )}

        {showCommentsButton && (
          <button
            id="doc-comments-btn"
            type="button"
            onClick={onCommentsToggle}
            disabled={isCommentsButtonDisabled}
            aria-pressed={isCommentsSidebarOpen}
            aria-label={`${isCommentsSidebarOpen ? 'Close' : 'Open'} comments sidebar. ${commentsSummary}.`}
            className={[
              'inline-flex items-center justify-center rounded-sm py-[5px] px-2 transition-colors duration-150 h-7',
              isCommentsButtonDisabled
                ? 'text-muted-foreground opacity-60 cursor-not-allowed'
                : isCommentsSidebarOpen
                  ? 'text-primary bg-[var(--nd-toolbar-hover-bg)] cursor-pointer'
                  : 'text-foreground hover:text-primary hover:bg-[var(--nd-toolbar-hover-bg)] cursor-pointer',
            ].join(' ')}
          >
            <Comments />
          </button>
        )}

        {/* Share button */}
        {isShareEnabled && (
          <button
            ref={shareButtonRef}
            id="doc-share-btn"
            type="button"
            onClick={handleShareToggle}
            aria-haspopup="dialog"
            aria-expanded={isShareOpen}
            className="
              inline-flex items-center gap-1.5 rounded-sm
              border border-border bg-background
              px-2.5 py-[5px]
              text-[12.5px] font-medium leading-none text-foreground
              transition-colors duration-150
              hover:bg-[var(--nd-toolbar-hover-bg)]
              cursor-pointer h-7
            "
          >
            <Globe />
            Share
          </button>
        )}
      </div>

      {/* ── Share panel (dropdown) ── */}
      {isShareEnabled && (
        <SharePanel
          documentId={documentId}
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          anchorRef={shareButtonRef}
        />
      )}
    </>
  );
}
