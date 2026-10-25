import type { ReactNode } from 'react';
import { NextDocs } from '@/icons';

interface SidebarBrandProps {
  name: string;
  /** Workspace icon; falls back to the NextDocs mark. */
  icon?: ReactNode;
}

/**
 * The wordmark lockup at the top of the rail. The workspace round replaces the
 * name and optional icon without touching the tree below it.
 */
export function SidebarBrand({ name, icon }: SidebarBrandProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-sm px-1.5 py-1">
      <span className="flex-shrink-0">{icon ?? <NextDocs className="h-[26px] w-[26px]" />}</span>
      <span className="truncate whitespace-nowrap text-[22px] font-[600] leading-none" title={name}>
        {name}
      </span>
    </div>
  );
}
