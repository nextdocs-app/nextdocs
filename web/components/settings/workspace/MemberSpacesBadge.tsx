'use client';

import { useId } from 'react';
import { PageIcon } from '@/components/page/PageIcon';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel.hook';
import { ChevronDown, Workspace as WorkspaceGlyph } from '@/icons';
import type { WorkspaceMemberSpaceSummary } from '@/types/workspace.types';

type SpaceAccessLevel = WorkspaceMemberSpaceSummary['accessLevel'];

const ACCESS_LEVEL_LABELS: Record<SpaceAccessLevel, string> = {
  OWNER: 'Owner',
  EDIT: 'Can edit',
  COMMENT: 'Can comment',
  VIEW: 'Can view',
};

/** Ownership is the one level worth calling out; the rest share the muted chip. */
function accessBadgeClassName(level: SpaceAccessLevel): string {
  return level === 'OWNER'
    ? 'bg-primary/10 text-primary border-primary/20'
    : 'bg-muted text-muted-foreground border-border';
}

export function MemberSpacesBadge({
  spaces,
  memberName,
}: {
  spaces?: WorkspaceMemberSpaceSummary[] | null;
  memberName: string;
}) {
  const panel = useAnchoredPanel({ width: 260, align: 'left' });
  const panelId = useId();

  // Undefined means "not disclosed": the API omits space memberships for callers
  // who may not read space rosters. Rendering "None" there would be a lie.
  if (!spaces) {
    return null;
  }

  if (spaces.length === 0) {
    return (
      <div className="-ml-2 inline-flex items-center">
        <span className="inline-flex select-none items-center rounded-md px-2 py-1 text-[13px] text-muted-foreground/60">
          None
        </span>
      </div>
    );
  }

  const label = `${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}`;

  return (
    <div className="-ml-2 relative inline-flex items-center">
      <button
        ref={panel.triggerRef}
        type="button"
        onClick={panel.toggle}
        aria-haspopup="dialog"
        aria-expanded={panel.isOpen}
        aria-controls={panel.isOpen ? panelId : undefined}
        aria-label={`${label} for ${memberName}`}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span>{label}</span>
        <ChevronDown
          size={13}
          className={`opacity-60 transition-transform duration-150 ${panel.isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {panel.isOpen ? (
        <div
          ref={panel.panelRef}
          id={panelId}
          role="dialog"
          aria-label={`Spaces for ${memberName}`}
          style={panel.panelStyle}
          className="z-50 flex max-h-64 w-[260px] flex-col overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg text-popover-foreground animate-in fade-in-0 zoom-in-95 duration-100"
        >
          <div className="px-2.5 py-1.5 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Assigned Spaces
          </div>
          <div className="overflow-y-auto p-1 flex flex-col gap-0.5">
            {spaces.map((space) => (
              <div
                key={space.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {space.icon ? (
                      <PageIcon icon={space.icon} size={15} />
                    ) : (
                      <WorkspaceGlyph size={14} className="opacity-70" />
                    )}
                  </span>
                  <span className="truncate font-medium">{space.name}</span>
                </div>
                <span
                  className={`inline-flex flex-shrink-0 items-center rounded border px-1.5 py-0.5 text-[10.5px] font-medium leading-none ${accessBadgeClassName(space.accessLevel)}`}
                >
                  {ACCESS_LEVEL_LABELS[space.accessLevel]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
