'use client';

import { SectionHeading } from '@/components/SectionHeading';
import type { SettingsEntryId, SettingsGroup } from './types';

interface SettingsNavProps {
  groups: SettingsGroup[];
  activeId: SettingsEntryId;
  onSelect: (id: SettingsEntryId) => void;
}

export function SettingsNav({ groups, activeId, onSelect }: SettingsNavProps) {
  return (
    <nav
      aria-label="Settings"
      className="flex flex-col flex-shrink-0 border-b border-sidebar-border bg-sidebar sm:w-56 md:w-[15rem] sm:border-b-0 sm:border-r"
    >
      {/* Header with "Settings" title */}
      <div className="flex h-12 sm:h-auto items-center sm:items-start px-4 sm:px-2.5 pr-12 sm:pr-2.5 sm:pt-7 sm:pb-5 flex-shrink-0 border-b border-sidebar-border sm:border-b-0">
        <h2 className="px-0 sm:px-2 text-[15px] font-semibold tracking-tight text-sidebar-foreground leading-tight">
          Settings
        </h2>
      </div>

      {/* Small screens flatten groups into a scrollable tab row; vertical rail on larger screens. */}
      <div className="flex gap-1 overflow-x-auto p-2 sm:min-h-0 sm:flex-1 sm:flex-col sm:gap-4 sm:overflow-y-auto sm:px-2.5 sm:pt-0 sm:pb-3">
        {groups.map((group) => (
          <div key={group.id} className="contents sm:flex sm:flex-col">
            <SectionHeading className="hidden px-2 pb-1 sm:block">{group.label}</SectionHeading>
            <ul className="flex items-center gap-1 sm:flex-col sm:items-stretch sm:gap-px list-none m-0 p-0">
              {group.entries.map((entry) => {
                const Icon = entry.icon;
                const isActive = entry.id === activeId;

                return (
                  <li key={entry.id} className="contents sm:block">
                    <button
                      type="button"
                      onClick={() => onSelect(entry.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`group relative flex items-center gap-2 rounded-sm text-left text-[14px] transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring h-9 flex-shrink-0 px-3 sm:h-auto sm:w-full sm:px-2 sm:py-1.5 pointer-coarse:sm:py-2.5 ${
                        isActive
                          ? 'bg-sidebar-accent/70 text-sidebar-foreground font-medium hover:bg-sidebar-accent hover:text-sidebar-foreground'
                          : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                      }`}
                    >
                      <span
                        className="relative flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center"
                        aria-hidden="true"
                      >
                        <Icon size={16} className="flex-shrink-0 opacity-80" />
                      </span>
                      <span className="truncate flex-1 min-w-0">{entry.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
