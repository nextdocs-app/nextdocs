'use client';

import { useRef, useState, useCallback } from 'react';
import { SharePanel } from '@/components/SharePanel';
import { Comments, Globe } from '@/icons/index';

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
  /** documentId used for share panel */
  documentId: string;
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
  /** Callback to restore the document from trash */
  onRestore?: () => void;
}

export function DocToolbar({
  documentId,
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
  onRestore,
}: DocToolbarProps) {
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [showOfflineTooltip, setShowOfflineTooltip] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);

  const handleShareToggle = useCallback(() => {
    setIsShareOpen((prev) => !prev);
  }, []);

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

  return (
    <>
      {/* ── Offline badge (top-left, only when offline) ── */}
      {isOffline && (
        <div
          className="absolute top-2 left-4 z-40 pointer-events-auto"
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
              px-2.5 py-1
              text-[11px] text-muted-foreground
              select-none cursor-default
              transition-colors duration-150
              hover:bg-[var(--nd-toolbar-hover-bg)]
            "
          >
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
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
              "
            >
              <div className="text-[11px] font-medium text-foreground">Offline changes</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{offlineTooltipText}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Top-right toolbar ── */}
      <div className="nd-doc-toolbar fixed top-2 right-2 z-40 flex items-center gap-1.5">
        {showTrashNotice && onRestore && (
          <div
            className="
              inline-flex items-center gap-1.5 rounded-lg
              border border-border/70 bg-background/85 backdrop-blur-sm
              px-3 py-1.5
              text-[12px] text-muted-foreground
              shadow-sm
              whitespace-nowrap
            "
          >
            <span>This document is in the trash.</span>
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
          </div>
        )}

        {shouldShowGuestNotice && (
          <div
            className="
              inline-flex items-center gap-1.5 rounded-lg
              border border-border/70 bg-background/85 backdrop-blur-sm
              px-3 py-1.5
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
              'inline-flex items-center justify-center rounded-sm py-[5px] px-2 transition-colors duration-150',
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
              cursor-pointer
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
