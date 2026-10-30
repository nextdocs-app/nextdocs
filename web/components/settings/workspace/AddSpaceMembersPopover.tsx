'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Portal } from '@/components/Portal';
import { AccessDropdown } from '@/components/share/AccessDropdown';
import { ShareAvatar } from '@/components/share/CollaboratorRow';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel.hook';
import { CircleCheck, Plus, Search } from '@/icons';
import { ApiError } from '@/services/api-client';
import { spaceApiService } from '@/services/space.service';
import { workspaceApiService } from '@/services/workspace.service';
import type { Space, SpaceAccessLevel, SpaceMember } from '@/types/space.types';
import type { WorkspaceMember } from '@/types/workspace.types';
import { SPACE_MEMBER_LEVEL_OPTIONS, type SpaceNotice } from './space-access.util';

const PANEL_WIDTH = 320;

const TRIGGER_CLASS_NAME =
  'inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[var(--nd-brand)] px-3 text-[12.5px] font-medium text-[var(--nd-brand-foreground)] shadow-xs transition-colors hover:bg-[var(--nd-brand-hover)] active:bg-[var(--nd-brand-active)] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function displayName(member: { displayName?: string | null; email: string }): string {
  return member.displayName?.trim() || member.email;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The space roster's "Add members" trigger. The popover searches the workspace
 * roster and adds the picked person at the chosen level; people already in the
 * space are filtered out, and the roster is refetched every time it opens so a
 * stale candidate cannot only fail after the click.
 */
export function AddSpaceMembersPopover({
  space,
  accessToken,
  memberIds,
  onAdded,
  onRefreshRoster,
  onNotice,
}: {
  space: Space;
  accessToken: string;
  /** People already in the space; they are not offered again. */
  memberIds: ReadonlySet<string>;
  onAdded: (roster: SpaceMember[]) => void;
  onRefreshRoster: () => void;
  onNotice: (notice: SpaceNotice | null) => void;
}) {
  const panel = useAnchoredPanel({ width: PANEL_WIDTH, align: 'right' });
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[] | null>(null);
  const [isLoadFailed, setIsLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<SpaceAccessLevel>('VIEW');
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [addedName, setAddedName] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!panel.isOpen) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setIsLoadFailed(false);

    workspaceApiService
      .listMembers(accessToken, controller.signal)
      .then((roster) => {
        if (!cancelled) {
          setWorkspaceMembers(roster);
        }
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) {
          // Without the workspace roster there is nothing to offer; say so
          // instead of claiming everybody is already in the space.
          setWorkspaceMembers([]);
          setIsLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [panel.isOpen, accessToken, reloadKey]);

  // Every visit starts from a clean search and no leftover confirmation.
  useEffect(() => {
    if (!panel.isOpen) {
      return;
    }

    setQuery('');
    setAddedName(null);
    searchRef.current?.focus();
  }, [panel.isOpen]);

  const candidates = useMemo(
    () => (workspaceMembers ?? []).filter((member) => !memberIds.has(member.userId)),
    [workspaceMembers, memberIds]
  );

  // Suggestions stay hidden until the caller types; a single character is
  // enough to match, so the list never reads like a directory dump.
  const trimmedQuery = query.trim();
  const visibleCandidates = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    if (!needle) {
      return [];
    }

    return candidates.filter(
      (member) =>
        displayName(member).toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle)
    );
  }, [candidates, trimmedQuery]);

  const add = async (member: WorkspaceMember) => {
    if (addingUserId) {
      return;
    }

    setAddingUserId(member.userId);
    setAddedName(null);
    onNotice(null);
    try {
      const roster = await spaceApiService.addMember(accessToken, space.id, member.email, level);
      onAdded(roster);
      // The added person drops out of the results; reset the search so the next
      // pick starts from a deliberate query instead of a stale filter.
      setQuery('');
      setAddedName(displayName(member));
      onNotice({
        kind: 'status',
        message: `${displayName(member)} was added to this space.`,
      });
    } catch (error) {
      onNotice({ kind: 'error', message: messageFor(error, 'Could not add that person.') });
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        // The workspace or space roster moved under us: reload both so the
        // picker stops offering someone who has left or already joined.
        setReloadKey((key) => key + 1);
        onRefreshRoster();
      }
    } finally {
      setAddingUserId(null);
    }
  };

  return (
    <>
      <button
        ref={panel.triggerRef}
        type="button"
        onClick={panel.toggle}
        aria-haspopup="dialog"
        aria-expanded={panel.isOpen}
        className={TRIGGER_CLASS_NAME}
      >
        <Plus size={13} strokeWidth={2.5} />
        <span>Add members</span>
      </button>

      {panel.isOpen ? (
        <Portal>
          <div
            ref={panel.panelRef}
            role="dialog"
            aria-label="Add members"
            style={panel.panelStyle}
            className="z-[70] flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-100"
          >
            <div className="flex flex-col border-b border-border px-3 pb-2.5 pt-3">
              <h3 className="text-[13px] font-semibold leading-snug">Add members</h3>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                Search people in your workspace.
              </p>

              <label className="relative mt-2 block">
                <span className="sr-only">Search workspace members</span>
                <Search
                  size={14}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or email"
                  aria-label="Search workspace members"
                  className="h-9 w-full rounded-md border border-border bg-transparent pl-8 pr-3 text-[13px] shadow-xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>

              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">Access</span>
                <AccessDropdown<SpaceAccessLevel>
                  value={level}
                  options={SPACE_MEMBER_LEVEL_OPTIONS}
                  onChange={setLevel}
                  disabled={addingUserId !== null}
                  align="right"
                  ariaLabel="Access level for new members"
                  muted
                />
              </div>
            </div>

            <div className="max-h-[14rem] min-h-[2.5rem] overflow-y-auto p-1">
              {workspaceMembers === null && !isLoadFailed ? (
                <p className="px-2 py-3 text-[12.5px] text-muted-foreground">
                  Loading workspace members…
                </p>
              ) : isLoadFailed ? (
                <div className="flex flex-col items-start gap-1 px-2 py-3">
                  <p className="text-[12.5px] text-muted-foreground">
                    Could not load the workspace members.
                  </p>
                  <button
                    type="button"
                    onClick={() => setReloadKey((key) => key + 1)}
                    className="rounded-sm text-[12.5px] font-medium text-foreground underline-offset-2 hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    Try again
                  </button>
                </div>
              ) : candidates.length === 0 ? (
                <p className="px-2 py-3 text-[12.5px] text-muted-foreground">
                  Everyone in the workspace is already here.
                </p>
              ) : trimmedQuery.length === 0 ? (
                <p className="px-2 py-3 text-[12.5px] text-muted-foreground">
                  Start typing a name or email to see suggestions.
                </p>
              ) : visibleCandidates.length === 0 ? (
                <p className="px-2 py-3 text-[12.5px] text-muted-foreground">
                  No one matches “{trimmedQuery}”.
                </p>
              ) : (
                <ul className="flex list-none flex-col p-0">
                  {visibleCandidates.map((member) => {
                    const name = displayName(member);
                    const isAdding = addingUserId === member.userId;

                    return (
                      <li
                        key={member.userId}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1.5"
                      >
                        {member.avatarUrl ? (
                          // Avatar URLs come from the user's profile; a 32px crop
                          // does not need an optimizer hop.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={member.avatarUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <ShareAvatar seed={member.userId} label={name} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium leading-snug">{name}</p>
                          <p className="truncate text-[11.5px] leading-snug text-muted-foreground/70">
                            {member.email}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void add(member)}
                          disabled={addingUserId !== null}
                          aria-label={`Add ${name}`}
                          className="inline-flex h-7 flex-shrink-0 items-center justify-center rounded-md border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {isAdding ? 'Adding…' : 'Add'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {addedName ? (
              <p
                role="status"
                className="flex items-center gap-1.5 border-t border-border bg-muted/30 px-3 py-2 text-[11.5px] leading-snug text-muted-foreground"
              >
                <CircleCheck
                  size={13}
                  aria-hidden="true"
                  className="flex-shrink-0 text-[#10b981]"
                />
                {addedName} added to this space.
              </p>
            ) : null}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
