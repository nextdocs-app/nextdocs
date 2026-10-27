import type { ReactNode } from 'react';
import { Workspace } from '@/icons';

interface WorkspaceLockupProps {
  name: string;
  /** Workspace icon; falls back to a neutral placeholder tile. */
  icon?: ReactNode;
}

/**
 * The workspace lockup at the top of the rail. Sized to the document toolbar's
 * row: a 23px mark and a 16px label, with the account row's 12px gap after the
 * mark.
 */
export function WorkspaceLockup({ name, icon }: WorkspaceLockupProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 overflow-hidden rounded-sm px-1.5">
      <span
        className={`flex h-[25px] w-[25px] flex-shrink-0 items-center justify-center ${
          icon ? '' : 'rounded-[5px] bg-[var(--nd-placeholder-bg)] text-[var(--nd-placeholder-fg)]'
        }`}
        data-testid={icon ? undefined : 'workspace-placeholder'}
      >
        {icon ?? <Workspace className="h-4 w-4" />}
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
