'use client';

import { Badge } from '@/components/Badge';
import { UserAvatar } from '@/components/UserAvatar';
import type { Collaborator } from '@/services/document.service';
import { AccessDropdown } from './AccessDropdown';
import {
  ACCESS_LABELS,
  LEAVE_LABEL,
  normalizeTitle,
  INVITE_ACCESS_OPTIONS,
  type CollaboratorDropdownValue,
  type DropdownOption,
} from './shareOptions';

/**
 * The row's menu. Exactly one revoke entry per row:
 *
 * - `NO_ACCESS` is the API's single revoke verb for other people. It writes a DENY
 *   breakpoint when an inherited channel exists to shadow (space membership, an
 *   ancestor grant, a workspace audience the roster does not render) and deletes the
 *   direct grant when nothing does, so a second "Remove" entry would only ever repeat
 *   that one write under another name.
 * - `LEAVE` is the self path (`DELETE /collaborators/me`): a self No access row is
 *   refused, and it would be a breakpoint only an admin could undo.
 * - `INHERIT` undoes an override by deleting the direct row, which is the same DELETE
 *   as a remove but a different promise, so it is labelled for its outcome.
 *
 * A row with no options is not editable at all: the caller does not administer
 * sharing and this is not their own removable membership. A single option means
 * "no action to offer", so the caller renders a plain label instead of a dead
 * dropdown — the same rule `spaceMemberOptions` follows.
 *
 * The creator is an ordinary OWNER row: their level is editable and removable like
 * any other owner's, and the API guards the page's last owner for all of them.
 */
export function getCollaboratorRowOptions(
  collab: Collaborator,
  {
    isSelf = false,
    canManageSharing = true,
    spaceArchived = false,
  }: {
    isSelf?: boolean;
    canManageSharing?: boolean;
    spaceArchived?: boolean;
  } = {}
): DropdownOption<CollaboratorDropdownValue>[] {
  const options: DropdownOption<CollaboratorDropdownValue>[] = [];

  if (canManageSharing) {
    options.push(...INVITE_ACCESS_OPTIONS);
  } else if (isSelf) {
    // A non-admin may not write a level, so their own row shows the configured grant
    // as a read-only entry. The viewer-level summary explains what actually resolves.
    options.push({
      value: collab.accessLevel,
      label: ACCESS_LABELS[collab.accessLevel] ?? collab.accessLevel,
    });
  }

  if (isSelf) {
    // Leave needs a direct ALLOW row (an inherited membership cannot be left; the API
    // answers 404).
    const canLeave = !spaceArchived && collab.accessLevel !== 'NO_ACCESS' && !collab.inherited;
    if (canLeave) {
      options.push({
        value: 'LEAVE',
        label: LEAVE_LABEL,
        dividerBefore: true,
        isDestructive: true,
      });
    }
    // An inherited owner's leave stays hidden: the API refuses it, and the level
    // arrives from a scope this row does not administer.
    return options;
  }

  if (!canManageSharing) {
    return options;
  }

  // An override (own level over an ancestor grant) offers its way back via an
  // explicit Inherit option. We append it rather than mutating the matching
  // access level option in place, which would break the selected state when the
  // override matches that level.
  const hasInheritOption = !collab.inherited && Boolean(collab.inheritedFromId);
  if (hasInheritOption) {
    const parentTitle = normalizeTitle(collab.inheritedFromTitle, '') || 'parent page';
    const inheritableLabel = collab.inheritedAccessLevel
      ? ACCESS_LABELS[collab.inheritedAccessLevel]
      : undefined;
    options.push({
      value: 'INHERIT',
      label: inheritableLabel
        ? `Inherit from ${parentTitle} (${inheritableLabel.toLowerCase()})`
        : `Inherit from ${parentTitle}`,
      dividerBefore: false,
    });
  }

  options.push({
    value: 'NO_ACCESS',
    label: 'No access',
    dividerBefore: true,
    isDestructive: true,
  });

  return options;
}

export function CollaboratorRow({
  collab,
  isSelf,
  canManageSharing,
  spaceArchived = false,
  detail = null,
  onDetailClick,
  hasEffectivePublicLink,
  effectiveLinkAction,
  onAccessSelect,
}: {
  collab: Collaborator;
  isSelf: boolean;
  canManageSharing: boolean;
  spaceArchived?: boolean;
  detail?: string | null;
  onDetailClick?: () => void;
  hasEffectivePublicLink: boolean;
  effectiveLinkAction: string;
  onAccessSelect: (value: CollaboratorDropdownValue) => void;
}) {
  const options = getCollaboratorRowOptions(collab, {
    isSelf,
    canManageSharing,
    spaceArchived,
  });
  // Rows describe configured grants. The viewer-level summary is the only place that
  // combines independent sources; an admin cannot infer a person's effective level from
  // one row, and a lower direct grant no longer demotes a higher independent source.
  const displayLevel = collab.accessLevel;
  const selectedLevel = collab.accessLevel;
  // "comment this document" is ungrammatical; every other action reads fine.
  const linkActionPhrase = effectiveLinkAction === 'comment' ? 'comment on' : effectiveLinkAction;

  return (
    <li className="flex flex-col py-1 px-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors group/collab">
      <div className="flex items-center gap-2.5">
        <UserAvatar
          size="sm"
          seed={collab.userId}
          name={collab.displayName || collab.email}
          src={collab.avatarUrl}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-medium text-card-foreground truncate leading-snug min-w-0 shrink">
              {collab.displayName || collab.email}
            </span>
            {isSelf && (
              <span className="text-[11.5px] font-normal text-muted-foreground whitespace-nowrap flex-shrink-0">
                (you)
              </span>
            )}
            {detail && (
              <Badge
                onClick={onDetailClick}
                title={detail}
                className="min-w-0 max-w-[140px] shrink-[2]"
              >
                <span className="block min-w-0 truncate">{detail}</span>
              </Badge>
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground/70 truncate leading-snug mt-0.5">
            {collab.email}
          </p>
        </div>

        {options.length > 1 ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <AccessDropdown
              value={selectedLevel}
              options={options}
              onChange={onAccessSelect}
              align="right"
              muted
            />
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[13px] text-muted-foreground/80 font-medium select-none">
              <span>{ACCESS_LABELS[displayLevel] ?? displayLevel}</span>
            </span>
          </div>
        )}
      </div>

      {displayLevel === 'NO_ACCESS' && hasEffectivePublicLink && (
        <p className="mt-1 pl-9 text-[11px] text-amber-600 dark:text-amber-400/90 leading-tight">
          {collab.displayName || collab.email} is blocked while signed in; anyone with the public
          link can still {linkActionPhrase} this document.
        </p>
      )}
    </li>
  );
}
