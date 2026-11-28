'use client';

import { useId, useState, type ReactNode } from 'react';
import { UserAvatar } from '@/components/UserAvatar';
import { getAvatarBackground } from '@/lib/avatar.util';
import { formatRelativeTime } from '@/lib/relative-time.util';

export interface ProfileCardUser {
  id: string;
  displayName: string;
  /** Omitted where the surface deliberately does not disclose contact details. */
  email?: string;
  avatarUrl?: string | null;
}

export function UserProfileCard({
  user,
  lastViewedAt,
  isActive = false,
  isCurrentUser = false,
  presenceColor,
  children,
}: {
  user: ProfileCardUser;
  /** Only pass this in page contexts where viewing history is relevant. */
  lastViewedAt?: string | null;
  isActive?: boolean;
  isCurrentUser?: boolean;
  presenceColor?: string;
  children: ReactNode;
}) {
  const cardId = useId();
  const formattedLastViewed = formatRelativeTime(lastViewedAt);
  const [isOpen, setIsOpen] = useState(false);
  const dotColor = presenceColor || getAvatarBackground(user.id);

  return (
    <button
      type="button"
      className="group/user-profile relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      aria-label={`View ${user.displayName}'s profile`}
      aria-expanded={isOpen}
      aria-controls={cardId}
      aria-describedby={cardId}
      onClick={() => setIsOpen(true)}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.matches(':focus')) setIsOpen(false);
      }}
      onFocus={() => setIsOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setIsOpen(false);
      }}
    >
      {children}
      <span
        id={cardId}
        role="tooltip"
        className={`pointer-events-auto absolute right-0 top-full z-[60] pt-2 transition-opacity ${
          isOpen ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <span className="block w-64 rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar)] p-3 text-left shadow-xl shadow-black/15">
          <span className="flex min-w-0 items-center gap-3">
            <UserAvatar seed={user.id} name={user.displayName} src={user.avatarUrl} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {user.displayName}
                {isCurrentUser ? ' (You)' : ''}
              </span>
              {user.email ? (
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              ) : null}
            </span>
          </span>
          {isActive ? (
            <span className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--sidebar-border)] pt-2 text-xs">
              <span className="text-muted-foreground">Status</span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-full border-[1.5px] border-background"
                  style={{ backgroundColor: dotColor }}
                  aria-hidden="true"
                />
                Active now
              </span>
            </span>
          ) : formattedLastViewed ? (
            <span className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--sidebar-border)] pt-2 text-xs">
              <span className="text-muted-foreground">Last viewed</span>
              <span className="text-foreground">{formattedLastViewed}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
