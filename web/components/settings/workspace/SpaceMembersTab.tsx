'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { AccessDropdown } from '@/components/share/AccessDropdown';
import { ShareAvatar } from '@/components/share/CollaboratorRow';
import { Search, Users } from '@/icons';
import { ApiError } from '@/services/api-client';
import { spaceApiService } from '@/services/space.service';
import type { Space, SpaceAccessLevel, SpaceMember } from '@/types/space.types';
import { AddSpaceMembersPopover } from './AddSpaceMembersPopover';
import {
  SPACE_LEVEL_LABELS,
  formatSpaceDate,
  spaceMemberOptions,
  type SpaceMemberAction,
  type SpaceNotice,
} from './space-access.util';

function displayName(member: { displayName?: string | null; email: string }): string {
  return member.displayName?.trim() || member.email;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function MemberAvatar({ member }: { member: SpaceMember }) {
  if (member.avatarUrl) {
    return (
      // Avatars are user-provided URLs; a 32px crop does not need an optimizer
      // hop. `no-referrer` keeps this host out of their logs.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
      />
    );
  }

  return <ShareAvatar seed={member.userId} label={displayName(member)} />;
}

/**
 * The space roster. Everyone listed can read the roster; only a space owner or
 * workspace admin changes levels or removes people, and any listed member may
 * leave. An archived space keeps the roster readable and leaving available,
 * because every other write is rejected until it is restored.
 */
export function SpaceMembersTab({
  space,
  accessToken,
  selfId,
  onRosterChange,
  onSelfMembershipChange,
  onNotice,
}: {
  space: Space;
  accessToken: string;
  selfId: string | null;
  onRosterChange: (roster: SpaceMember[]) => void;
  /** The caller's own row changed, so their level and admin rights may have too. */
  onSelfMembershipChange: () => void;
  onNotice: (notice: SpaceNotice | null) => void;
}) {
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    member: SpaceMember;
    isLeaving: boolean;
  } | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const canManage = space.canAdminister && !space.archivedAt;
  const ownerCount = members.filter((member) => member.accessLevel === 'OWNER').length;
  // The caller re-renders on every roster count change; keeping the callback in
  // a ref stops that render from re-running the load effect.
  const onRosterChangeRef = useRef(onRosterChange);

  useEffect(() => {
    onRosterChangeRef.current = onRosterChange;
  }, [onRosterChange]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    spaceApiService
      .listMembers(accessToken, space.id, controller.signal)
      .then((roster) => {
        if (cancelled) {
          return;
        }

        setMembers(roster);
        onRosterChangeRef.current(roster);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setLoadError(
            error instanceof ApiError && error.status === 403
              ? 'Only people in this space can see who else is here.'
              : messageFor(error, 'Could not load the space members.')
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, space.id, reloadKey]);

  const memberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);

  const visibleMembers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return members;
    }

    return members.filter(
      (member) =>
        displayName(member).toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle)
    );
  }, [members, query]);

  const applyRoster = (roster: SpaceMember[]) => {
    setMembers(roster);
    onRosterChangeRef.current(roster);
  };

  const refresh = () => {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((key) => key + 1);
  };

  const changeLevel = async (member: SpaceMember, accessLevel: SpaceAccessLevel) => {
    setBusyKey(`level:${member.userId}`);
    onNotice(null);
    try {
      const roster = await spaceApiService.updateMemberAccess(
        accessToken,
        space.id,
        member.userId,
        accessLevel
      );
      applyRoster(roster);
      onNotice({
        kind: 'status',
        message: `${displayName(member)} is now ${SPACE_LEVEL_LABELS[accessLevel]} in this space.`,
      });
      if (member.userId === selfId) {
        onSelfMembershipChange();
      }
    } catch (error) {
      onNotice({ kind: 'error', message: messageFor(error, 'Could not change the access level.') });
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404 || error.status === 409)
      ) {
        refresh();
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleAction = (member: SpaceMember, action: SpaceMemberAction) => {
    if (action === member.accessLevel) {
      return;
    }

    if (action === 'REMOVE') {
      // An administrator's own row offers REMOVE labelled "Leave space": the confirm copy
      // and the post-removal refresh key off who is removed, not the action name.
      setPendingRemoval({ member, isLeaving: member.userId === selfId });
      return;
    }

    if (action === 'LEAVE') {
      setPendingRemoval({ member, isLeaving: true });
      return;
    }

    void changeLevel(member, action);
  };

  const handleRemove = async () => {
    if (!pendingRemoval) {
      return;
    }

    const { member, isLeaving } = pendingRemoval;
    setIsRemoving(true);
    onNotice(null);
    try {
      const roster = await spaceApiService.removeMember(accessToken, space.id, member.userId);
      applyRoster(roster);
      onNotice({
        kind: 'status',
        message: isLeaving
          ? `You left ${space.name}.`
          : `${displayName(member)} was removed from this space.`,
      });
      setPendingRemoval(null);
      if (isLeaving) {
        onSelfMembershipChange();
      }
    } catch (error) {
      onNotice({ kind: 'error', message: messageFor(error, 'Could not remove that member.') });
      setPendingRemoval(null);
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404 || error.status === 409)
      ) {
        refresh();
      }
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search members</span>
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search members"
            aria-label="Search members"
            className="h-9 w-full rounded-md border border-border bg-transparent pl-8 pr-3 text-[13px] shadow-xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>

        {canManage ? (
          <AddSpaceMembersPopover
            space={space}
            accessToken={accessToken}
            memberIds={memberIds}
            onAdded={applyRoster}
            onRefreshRoster={refresh}
            onNotice={onNotice}
          />
        ) : null}
      </div>

      {loadError ? (
        <p role="alert" className="text-[12.5px] leading-snug text-destructive">
          {loadError}
        </p>
      ) : null}

      {isLoading && members.length === 0 ? (
        <p className="py-3.5 text-[13px] text-muted-foreground">Loading members…</p>
      ) : (
        <>
          {members.length === 0 ? (
            <p className="py-3.5 text-[13px] text-muted-foreground">No one has been added yet.</p>
          ) : visibleMembers.length === 0 ? (
            <p className="py-3.5 text-[13px] text-muted-foreground">
              No members match “{query.trim()}”.
            </p>
          ) : null}

          {visibleMembers.length > 0 || space.accessMode === 'PUBLIC' ? (
            <div
              tabIndex={0}
              role="region"
              aria-label={`Members of ${space.name}`}
              className="table-wrapper w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border text-[12px] font-medium text-muted-foreground/80">
                    <th scope="col" className="py-2.5 pl-1 pr-4 text-left font-medium">
                      Name
                    </th>
                    <th scope="col" className="py-2.5 pl-4 pr-1 text-left font-medium">
                      Access
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {visibleMembers.map((member) => {
                    const isSelf = member.userId === selfId;
                    const name = displayName(member);
                    const options = spaceMemberOptions({
                      canAdminister: canManage,
                      memberLevel: member.accessLevel,
                      isSelf,
                      ownerCount,
                    });
                    const addedAt = formatSpaceDate(member.addedAt);

                    return (
                      <tr key={member.userId} className="transition-colors hover:bg-muted/30">
                        <td className="py-2.5 pl-1 pr-4 align-middle">
                          <div className="flex items-center gap-3">
                            <MemberAvatar member={member} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[13.5px] font-medium leading-snug">
                                  {name}
                                </span>
                                {isSelf ? (
                                  <span className="flex-shrink-0 text-[11.5px] font-normal text-muted-foreground">
                                    (you)
                                  </span>
                                ) : null}
                              </div>
                              <p className="truncate text-[12px] leading-snug text-muted-foreground/70">
                                {member.email}
                                {addedAt ? ` · Added ${addedAt}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-2.5 pl-4 pr-1 align-middle">
                          {options.length > 1 ? (
                            <div className="-ml-2 flex items-center">
                              <AccessDropdown<SpaceMemberAction>
                                value={member.accessLevel}
                                options={options}
                                onChange={(action) => handleAction(member, action)}
                                disabled={busyKey === `level:${member.userId}`}
                                align="left"
                                ariaLabel={`Access level for ${name}`}
                                muted
                              />
                            </div>
                          ) : (
                            <div className="-ml-2 flex items-center">
                              <span className="inline-flex select-none items-center rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground/80">
                                {SPACE_LEVEL_LABELS[member.accessLevel]}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {space.accessMode === 'PUBLIC' ? (
                    <tr>
                      <td className="py-2.5 pl-1 pr-4 align-middle">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                          >
                            <Users size={15} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-medium leading-snug">
                              Everyone in this workspace
                            </p>
                            <p className="truncate text-[12px] leading-snug text-muted-foreground/70">
                              Access is set in General.
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pl-4 pr-1 align-middle">
                        <div className="-ml-2 flex items-center">
                          <span className="inline-flex select-none items-center rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground/80">
                            {SPACE_LEVEL_LABELS[space.everyoneAccessLevel]}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

      <ConfirmationModal
        isOpen={pendingRemoval !== null}
        title={
          pendingRemoval?.isLeaving
            ? `Leave ${space.name}?`
            : `Remove ${pendingRemoval ? displayName(pendingRemoval.member) : 'this member'}?`
        }
        description={
          pendingRemoval?.isLeaving
            ? 'You will lose access to the documents in this space unless it is public in the workspace.'
            : 'They lose access to this space immediately. Their documents and workspace membership stay untouched.'
        }
        confirmLabel={pendingRemoval?.isLeaving ? 'Leave' : 'Remove'}
        tone="danger"
        isConfirming={isRemoving}
        onConfirm={() => void handleRemove()}
        onCancel={() => {
          if (!isRemoving) {
            setPendingRemoval(null);
          }
        }}
      />
    </div>
  );
}
