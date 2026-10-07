'use client';

import { getPresenceColor } from '@/lib/realtime.util';
import type { Collaborator } from '@/services/document.service';
import { AccessDropdown } from './AccessDropdown';
import {
  ACCESS_LABELS,
  normalizeTitle,
  type CollaboratorDropdownValue,
  type DropdownOption,
} from './shareOptions';

export function ShareAvatar({ seed, label }: { seed: string; label: string }) {
  const normalizedLabel = (label ?? '').trim();
  const initial = (normalizedLabel || '?').charAt(0).toUpperCase();
  const bg = getPresenceColor(seed);
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white select-none shadow-xs"
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
    { value: 'OWNER', label: 'Full access' },
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

  return options;
}

function ProvenanceBadge({
  kind,
  rawTitle,
  targetId,
  onNavigateTo,
}: {
  kind: 'via' | 'overrides';
  rawTitle?: string | null;
  targetId?: string | null;
  onNavigateTo: (documentId: string) => void;
}) {
  const display = normalizeTitle(rawTitle);
  const fullTitle =
    kind === 'via'
      ? `Inherited via ${normalizeTitle(rawTitle, '').trim() || 'parent'}`
      : `Overrides ${normalizeTitle(rawTitle, '').trim() || 'parent'}`;
  const prefix = kind === 'via' ? 'via' : 'Overrides';
  const className =
    'inline-block min-w-0 max-w-[140px] shrink-[2] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle';
  if (targetId) {
    return (
      <button
        type="button"
        onClick={() => targetId && onNavigateTo(targetId)}
        title={fullTitle}
        className={`${className} hover:bg-muted-foreground/15 hover:text-foreground transition-colors cursor-pointer`}
      >
        {prefix} {display}
      </button>
    );
  }
  return (
    <span title={fullTitle} className={className}>
      {prefix} {display}
    </span>
  );
}

export function CollaboratorRow({
  collab,
  isSelf,
  canEditRow,
  hasEffectivePublicLink,
  effectiveLinkAction,
  onAccessSelect,
  onNavigateTo,
}: {
  collab: Collaborator;
  isSelf: boolean;
  canEditRow: boolean;
  hasEffectivePublicLink: boolean;
  effectiveLinkAction: string;
  onAccessSelect: (value: CollaboratorDropdownValue) => void;
  onNavigateTo: (documentId: string) => void;
}) {
  const isInherited = Boolean(collab.inherited);
  // "comment this document" is ungrammatical; every other action reads fine.
  const linkActionPhrase = effectiveLinkAction === 'comment' ? 'comment on' : effectiveLinkAction;

  return (
    <li className="flex flex-col py-1.5 px-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors group/collab">
      <div className="flex items-center gap-2.5">
        <ShareAvatar seed={collab.userId} label={collab.displayName || collab.email} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13.5px] font-medium text-card-foreground truncate leading-snug min-w-0 shrink">
              {collab.displayName || collab.email}
            </span>
            {isSelf && (
              <span className="text-[12px] font-normal text-muted-foreground whitespace-nowrap flex-shrink-0">
                (you)
              </span>
            )}
            {isInherited && (
              <ProvenanceBadge
                kind="via"
                rawTitle={collab.inheritedFromTitle}
                targetId={collab.inheritedFromId}
                onNavigateTo={onNavigateTo}
              />
            )}
            {!isInherited && Boolean(collab.inheritedFromTitle) && (
              <ProvenanceBadge
                kind="overrides"
                rawTitle={collab.inheritedFromTitle}
                targetId={collab.inheritedFromId}
                onNavigateTo={onNavigateTo}
              />
            )}
          </div>
          <p className="text-[12px] text-muted-foreground/70 truncate leading-snug mt-0.5">
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
              <span>{ACCESS_LABELS[collab.accessLevel] ?? collab.accessLevel}</span>
            </span>
          </div>
        )}
      </div>

      {collab.accessLevel === 'NO_ACCESS' && hasEffectivePublicLink && (
        <p className="mt-1 pl-10 text-[11.5px] text-amber-600 dark:text-amber-400/90 leading-tight">
          {collab.displayName || collab.email} is blocked while signed in; anyone with the public
          link can still {linkActionPhrase} this document.
        </p>
      )}
    </li>
  );
}
