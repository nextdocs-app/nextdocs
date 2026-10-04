'use client';

import { getPresenceColor } from '@/lib/realtime.util';
import type { Collaborator } from '@/services/document.service';
import { AccessDropdown } from './AccessDropdown';
import { ACCESS_LABELS, type DropdownOption } from './shareOptions';

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

export function getCollaboratorRowOptions(collab: Collaborator): DropdownOption[] {
  const options: DropdownOption[] = [
    { value: 'OWNER', label: 'Full access' },
    { value: 'EDIT', label: 'Can edit' },
    { value: 'COMMENT', label: 'Can comment' },
    { value: 'VIEW', label: 'Can view' },
  ];

  if (!collab.inherited && collab.inheritedFromTitle) {
    const parentTitle = collab.inheritedFromTitle.trim().replace(/\s+/g, ' ');
    const parentLevel = collab.inheritedAccessLevel
      ? ACCESS_LABELS[collab.inheritedAccessLevel] || collab.inheritedAccessLevel
      : null;
    const inheritLabel = parentLevel
      ? `Inherit from ${parentTitle} (${parentLevel})`
      : `Inherit from ${parentTitle}`;
    options.push({
      value: 'INHERIT',
      label: inheritLabel,
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
  const display = (rawTitle || 'parent').trim().replace(/\s+/g, ' ');
  const fullTitle =
    kind === 'via'
      ? `Inherited via ${(rawTitle || 'parent').trim()}`
      : `Overrides ${(rawTitle || 'parent').trim()}`;
  const prefix = kind === 'via' ? 'via' : 'Overrides';
  const className =
    'inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0';
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
  onAccessSelect: (value: string) => void;
  onNavigateTo: (documentId: string) => void;
}) {
  const isInherited = Boolean(collab.inherited);

  return (
    <li className="flex flex-col py-1.5 px-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors group/collab">
      <div className="flex items-center gap-2.5">
        <ShareAvatar seed={collab.userId} label={collab.displayName || collab.email} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13.5px] font-medium text-card-foreground truncate leading-snug min-w-0">
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
          link can still {effectiveLinkAction} this document.
        </p>
      )}
    </li>
  );
}
