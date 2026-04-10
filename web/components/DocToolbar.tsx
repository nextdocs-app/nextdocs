'use client';

import { useRef, useState, useCallback } from 'react';
import { SharePanel } from '@/components/SharePanel';

function ShareIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="12.5" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="3.5" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.5" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 7l6-3M5 9l6 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CommentsIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v7A1.5 1.5 0 0 1 12.5 11H9l-2.5 3L4 11H3.5A1.5 1.5 0 0 1 2 9.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M5 5h6M5 7.5h4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

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
  /** Whether the real-time socket is currently offline */
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
          className="fixed top-3 left-[17rem] z-40"
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
      <div className="nd-doc-toolbar fixed top-3 right-4 z-40 flex items-center gap-2">
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
          <span className="text-[12px] text-muted-foreground/60 select-none hidden sm:block mr-1">
            {lastEditedLabel}
          </span>
        )}

        {/* Comments toggle button */}
        {showCommentsButton && (
          <button
            id="doc-comments-btn"
            type="button"
            onClick={onCommentsToggle ? onCommentsToggle : undefined}
            disabled={isCommentsButtonDisabled}
            aria-disabled={isCommentsButtonDisabled}
            aria-pressed={isCommentsSidebarOpen}
            aria-label={
              isCommentsButtonDisabled
                ? `Comments unavailable. ${commentsSummary}.`
                : isCommentsSidebarOpen
                  ? `Close comments sidebar. ${commentsSummary}.`
                  : `Open comments sidebar. ${commentsSummary}.`
            }
            title={
              isCommentsButtonDisabled
                ? `Comments unavailable (${commentsSummary})`
                : isCommentsSidebarOpen
                  ? `Close comments (${commentsSummary})`
                  : `Open comments (${commentsSummary})`
            }
            className={[
              'inline-flex items-center gap-1.5 rounded-lg',
              'border px-3 py-1.5',
              'text-[13px] font-medium',
              'active:scale-95 transition-all duration-100 shadow-sm',
              isCommentsButtonDisabled
                ? 'border-border bg-background text-muted-foreground cursor-not-allowed opacity-60'
                : isCommentsSidebarOpen
                  ? 'border-primary/30 bg-primary/8 text-primary cursor-pointer'
                  : 'border-border bg-background text-foreground hover:bg-sidebar-accent cursor-pointer',
            ].join(' ')}
          >
            <CommentsIcon />
            <span className="hidden sm:inline">Comments</span>
            {openCommentsCount > 0 && (
              <span className="nd-toolbar-comments-count" aria-hidden="true">
                {openCommentsCount > 99 ? '99+' : openCommentsCount}
              </span>
            )}
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
              inline-flex items-center gap-1.5 rounded-lg
              border border-border bg-background
              px-3 py-1.5
              text-[13px] font-medium text-foreground
              hover:bg-sidebar-accent
              active:scale-95
              transition-all duration-100 cursor-pointer
              shadow-sm
            "
          >
            <ShareIcon />
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
