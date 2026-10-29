import {
  WorkspaceIconTile,
  workspaceIconTileStyle,
} from '@/components/workspace/WorkspaceIconTile';
import type { DocumentIcon } from '@/types/document.types';

export interface WorkspaceLockupProps {
  name: string;
  /** Workspace icon; falls back to a neutral placeholder tile. */
  workspaceIcon?: DocumentIcon | null;
}

/**
 * The workspace lockup at the top of the rail. Sized to the document toolbar's
 * row: a 23px mark and a 16px label, with the account row's 12px gap after the
 * mark.
 */
export function WorkspaceLockup({ name, workspaceIcon }: WorkspaceLockupProps) {
  const tile = workspaceIconTileStyle(workspaceIcon);

  return (
    <div className="flex min-w-0 items-center gap-2.5 overflow-hidden rounded-sm px-1.5">
      <span
        style={tile.style}
        className={`flex h-[25px] w-[25px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[5px] ${tile.className}`}
        data-testid={workspaceIcon ? undefined : 'workspace-placeholder'}
      >
        <WorkspaceIconTile icon={workspaceIcon} size={25} />
      </span>
      {/* Emoji ink sits about a pixel below the label's optical centre; nudge
          the label down so the lockup reads level. */}
      <span
        className="relative top-px truncate whitespace-nowrap text-[16px] font-medium leading-normal"
        title={name}
      >
        {name}
      </span>
    </div>
  );
}
