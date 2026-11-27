'use client';

import { useId, useRef, useState } from 'react';
import { AvatarGroup, getAvatarGroupCounts } from '@/components/AvatarGroup';
import { UserAvatar } from '@/components/UserAvatar';
import { UserProfileCard } from '@/components/profile/UserProfileCard';
import { useDismissableMenu } from '@/components/sidebar/useDismissableMenu';
import type { DocumentViewer } from '@/hooks/useDocumentViewers.hook';
import { formatRelativeTime } from '@/lib/relative-time.util';

const DEFAULT_MAX_AVATARS = 5;

function PresenceDot({ color, compact = false }: { color: string; compact?: boolean }) {
  return (
    <span
      className={`absolute rounded-full border-background ${
        compact
          ? '-bottom-px -right-px h-[9px] w-[9px] border-[1.5px]'
          : '-bottom-[1.5px] -right-[1.5px] h-2.5 w-2.5 border-[1.5px]'
      }`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

/**
 * The toolbar's "who has been here" cluster: a stacked avatar group that keeps
 * the most recently seen people visible and folds the rest into `+N`.
 */
export function ViewerStack({
  viewers,
  max = DEFAULT_MAX_AVATARS,
}: {
  viewers: DocumentViewer[];
  /** Maximum visible slots, including the overflow indicator. */
  max?: number;
}) {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isOverflowPinned, setIsOverflowPinned] = useState(false);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const overflowId = useId();

  useDismissableMenu({
    isOpen: isOverflowOpen,
    triggerRef: overflowTriggerRef,
    popupRef: overflowMenuRef,
    onDismiss: () => {
      setIsOverflowOpen(false);
      setIsOverflowPinned(false);
    },
  });

  // AvatarGroup renders the first `visibleCount`; the popover lists the same tail.
  const { visibleCount } = getAvatarGroupCounts(viewers.length, max);
  const hiddenViewers = viewers.slice(visibleCount);

  return (
    <AvatarGroup
      max={max}
      className="h-9 shrink-0 px-1 md:h-[30px]"
      ariaLabel="People who accessed this document"
      renderOverflow={() => (
        <div
          className="relative inline-flex items-center"
          onMouseEnter={() => setIsOverflowOpen(true)}
          onMouseLeave={() => {
            if (!isOverflowPinned) {
              setIsOverflowOpen(false);
            }
          }}
          onBlur={(event) => {
            if (
              !isOverflowPinned &&
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setIsOverflowOpen(false);
            }
          }}
        >
          <button
            ref={overflowTriggerRef}
            type="button"
            className="group/viewer-overflow relative z-0 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 hover:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-within:z-20"
            aria-label={`${hiddenViewers.length} more people who accessed this document`}
            aria-expanded={isOverflowOpen}
            aria-controls={overflowId}
            aria-describedby={overflowId}
            onClick={() => {
              setIsOverflowOpen((previous) => {
                const next = !previous || !isOverflowPinned;
                setIsOverflowPinned(next);
                return next;
              });
            }}
            onFocus={() => setIsOverflowOpen(true)}
          >
            <span
              aria-hidden="true"
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-full ring-2 ring-background bg-muted px-1 text-[11px] font-medium text-muted-foreground"
            >
              +{hiddenViewers.length}
            </span>
          </button>

          <div
            ref={overflowMenuRef}
            className={`pointer-events-auto fixed inset-x-2 top-11 z-[60] pt-2 transition-opacity sm:inset-x-auto sm:absolute sm:right-0 sm:top-full ${
              isOverflowOpen ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
            }`}
          >
            <div
              id={overflowId}
              role="tooltip"
              className="ml-auto block max-h-80 w-full max-w-72 overflow-y-auto rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar)] p-2 text-left shadow-xl shadow-black/15 sm:ml-0 sm:w-72"
            >
              <span className="block px-2 py-1 text-xs font-medium text-muted-foreground">
                People who accessed this document
              </span>
              {hiddenViewers.map((viewer) => (
                <div key={viewer.userId} className="flex items-center gap-2 rounded-lg px-2 py-2">
                  <span className="relative inline-flex">
                    <UserAvatar
                      seed={viewer.userId}
                      name={viewer.displayName}
                      src={viewer.avatarUrl}
                      size="sm"
                    />
                    {viewer.isActive && <PresenceDot color={viewer.presenceColor} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {viewer.displayName}
                      {viewer.isCurrentUser ? ' (You)' : ''}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {viewer.isActive ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          <span
                            className="h-2.5 w-2.5 rounded-full border-[1.5px] border-background"
                            style={{ backgroundColor: viewer.presenceColor }}
                            aria-hidden="true"
                          />
                          Active now
                        </span>
                      ) : (
                        `Last viewed ${formatRelativeTime(viewer.lastViewedAt) ?? 'recently'}`
                      )}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    >
      {viewers.map((viewer) => (
        <UserProfileCard
          key={viewer.userId}
          user={{
            id: viewer.userId,
            displayName: viewer.displayName,
            avatarUrl: viewer.avatarUrl,
          }}
          lastViewedAt={viewer.lastViewedAt}
          isActive={viewer.isActive}
          isCurrentUser={viewer.isCurrentUser}
          presenceColor={viewer.presenceColor}
        >
          <span className="relative inline-flex">
            <UserAvatar
              seed={viewer.userId}
              name={viewer.displayName}
              src={viewer.avatarUrl}
              size="xs"
              className="ring-2 ring-background transition-transform hover:scale-105"
            />
            {viewer.isActive && <PresenceDot color={viewer.presenceColor} compact />}
          </span>
        </UserProfileCard>
      ))}
    </AvatarGroup>
  );
}
