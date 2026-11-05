'use client';

import { Badge } from '@/components/Badge';
import { getPresenceColor } from '@/lib/realtime.util';
import type { Collaborator } from '@/services/document.service';
import { AccessDropdown } from './AccessDropdown';
import {
  ACCESS_LABELS,
  normalizeTitle,
  type CollaboratorDropdownValue,
  type DropdownOption,
} from './shareOptions';

export function ShareAvatar({
  seed,
  label,
  size = 'md',
}: {
  seed: string;
  label: string;
  size?: 'sm' | 'md';
}) {
  const normalizedLabel = (label ?? '').trim();
  const initial = (normalizedLabel || '?').charAt(0).toUpperCase();
  const bg = getPresenceColor(seed);
  const dimension = size === 'sm' ? 'h-7 w-7 text-[11.5px]' : 'h-8 w-8 text-[13px]';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${dimension} flex-shrink-0 items-center justify-center rounded-full font-semibold text-white select-none shadow-xs`}
      style={{ backgroundColor: bg }}
    >
      {initial}
    </span>
  );
}

export function getCollaboratorRowOptions(
  collab: Collaborator
): DropdownOption<CollaboratorDropdownValue>[] {
  const options: DropdownOption<CollaboratorDropdownValue>[] = [
    { value: 'OWNER' as const, label: 'Full access' },
    { value: 'EDIT', label: 'Can edit' },
    { value: 'COMMENT', label: 'Can comment' },
    { value: 'VIEW', label: 'Can view' },
  ];

  // An override (own level over an ancestor grant) offers its way back via
  // an explicit Inherit option. We append it rather than mutating the
  // matching access level option in place, which would break the selected
  // state when the override matches that level.
  // Whitespace-only titles normalize to '' (see below), so gate on the
  // normalized value to avoid rendering `Inherit from ` with an empty title.
  const hasInheritOption =
    !collab.inherited && normalizeTitle(collab.inheritedFromTitle, '').length > 0;
  if (hasInheritOption) {
    const parentTitle = normalizeTitle(collab.inheritedFromTitle, '');
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

  if (!collab.inherited && !hasInheritOption && !collab.owner) {
    options.push({
      value: 'REMOVE',
      label: 'Remove',
      dividerBefore: false,
      isDestructive: true,
    });
  }

  return options;
}

export function CollaboratorRow({
  collab,
  isSelf,
  canEditRow,
  detail = null,
  onDetailClick,
  hasEffectivePublicLink,
  effectiveLinkAction,
  onAccessSelect,
}: {
  collab: Collaborator;
  isSelf: boolean;
  canEditRow: boolean;
  detail?: string | null;
  onDetailClick?: () => void;
  hasEffectivePublicLink: boolean;
  effectiveLinkAction: string;
  onAccessSelect: (value: CollaboratorDropdownValue) => void;
}) {
  // The dropdown edits the stored grant; the effective level is shown only read-only.
  // An archived space caps even an explicit page owner at VIEW, so displayLevel
  // drives the badge and blocked note while collab.accessLevel drives the dropdown.
  const displayLevel = collab.effectiveAccessLevel ?? collab.accessLevel;
  // "comment this document" is ungrammatical; every other action reads fine.
  const linkActionPhrase = effectiveLinkAction === 'comment' ? 'comment on' : effectiveLinkAction;

  return (
    <li className="flex flex-col py-1 px-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors group/collab">
      <div className="flex items-center gap-2.5">
        <ShareAvatar size="sm" seed={collab.userId} label={collab.displayName || collab.email} />
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

        {canEditRow ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <AccessDropdown
              value={collab.accessLevel}
              options={getCollaboratorRowOptions(collab)}
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
