'use client';

import { Portal } from '@/components/Portal';

export const PICKER_PANEL_WIDTH = 360;
export const PICKER_PANEL_MAX_HEIGHT = 470;

/**
 * Popover chrome shared by the page icon and cover pickers.
 *
 * Portalled to the body so the panel is not clipped by (or ordered under) the
 * editor's stacking context, and surfaced like the app's other floating panels so
 * it reads as part of the same family: the share popover's card surface (the two
 * diverge in dark mode, where `--card` sits below `--popover`), its hairline ring
 * and divider tokens instead of a solid border, and the medium radius rather than
 * the rounder panel corners it used to carry.
 */
export function PickerShell({
  panelRef,
  style,
  label,
  inline = false,
  children,
}: {
  panelRef?: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
  label: string;
  /** Render in place instead of portalling; used inside the settings dialog. */
  inline?: boolean;
  children: React.ReactNode;
}) {
  const panel = (
    <div
      ref={panelRef}
      role={inline ? 'group' : 'dialog'}
      aria-label={label}
      style={
        inline
          ? undefined
          : {
              ...style,
              // Fixed 360px overflows viewports under ~376px (360 + 2×8 margin):
              // clamp to the viewport so the panel fits small phones instead of
              // bleeding past the right edge. Height clamps to the visual viewport
              // for short landscape screens the same way.
              width: `min(${PICKER_PANEL_WIDTH}px, calc(100vw - 16px))`,
              maxHeight: `min(${PICKER_PANEL_MAX_HEIGHT}px, calc(100dvh - 16px))`,
            }
      }
      className={
        inline
          ? 'nd-picker flex w-full flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground'
          : `
          nd-picker
          z-[9999] flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md
          bg-card text-card-foreground ring-1 ring-foreground/10 shadow-md
          animate-in fade-in slide-in-from-top-1 duration-100
        `
      }
    >
      {children}
    </div>
  );

  return inline ? panel : <Portal>{panel}</Portal>;
}

/**
 * The section switcher both pickers share.
 *
 * Matches the share popover's header row: the tabs carry the same
 * `px-3 py-2 text-[15px] font-semibold` rhythm as its "Share" title and the
 * open section is marked by the same 2px brand underline, so the two panels
 * read as one family. A pill track here fought the panel's own hairlines
 * and read as a different design language from the rest of the app.
 *
 * The underline lands on the row's bottom hairline, so the buttons carry
 * their own vertical padding rather than the row (which keeps `pb-0` like
 * the share header).
 */
export function PickerTabs<T extends string>({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: { id: T; label: string }[];
  activeTab: T;
  onSelect: (tab: T) => void;
}) {
  return (
    <div role="tablist" className="flex select-none items-center gap-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={`
              relative px-2.5 py-2 text-[15px] font-semibold transition-colors cursor-pointer
              focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
              sm:px-3
              ${
                isActive
                  ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[var(--nd-brand)]'
                  : 'text-muted-foreground/70 hover:text-foreground'
              }
            `}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** The header type both pickers use for a section title, matching the share popover. */
export const pickerSectionHeaderClassName =
  'text-[13.5px] font-medium text-muted-foreground/80 select-none';

/** Shared text field look, matching the sidebar's inputs rather than a form stack. */
export const pickerInputClassName =
  'w-full rounded-md border border-border/70 bg-transparent px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-[var(--nd-brand-ring)]';
