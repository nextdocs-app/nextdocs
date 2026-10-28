'use client';

import { SectionHeading } from '@/components/SectionHeading';
import type { SettingsGroup } from './types';

interface SettingsNavProps {
  groups: SettingsGroup[];
  activeId: string;
  onSelect: (id: string) => void;
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
            <div className="flex items-center gap-1 sm:flex-col sm:items-stretch sm:gap-0.5">
              {group.entries.map((entry) => {
                const Icon = entry.icon;
                const isActive = entry.id === activeId;

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onSelect(entry.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex h-9 flex-shrink-0 items-center gap-2 rounded-sm px-3 text-left text-[13.5px] transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-8 sm:px-2 ${
                      isActive
                        ? 'bg-sidebar-accent/70 font-medium text-sidebar-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" className="flex-shrink-0 opacity-80" />
                    <span className="truncate">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
