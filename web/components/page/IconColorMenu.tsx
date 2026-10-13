'use client';

import { ICON_COLORS, type IconColorId } from '@/lib/document-icon.util';

/**
 * Builtin icon color palette dropdown.
 *
 * Extracted from `IconPickerPanel` so the panel composes the menu rather than
 * owning its outside-click/Escape dismissal and option list.
 */
export function IconColorMenu({
  selectedColor,
  isOpen,
  menuRef,
  onToggle,
  onSelect,
}: {
  selectedColor: IconColorId;
  isOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onSelect: (color: IconColorId) => void;
}) {
  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        type="button"
        aria-label={`Icon color: ${ICON_COLORS.find((c) => c.id === selectedColor)?.label ?? 'Default'}`}
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border/70 hover:bg-[var(--nd-toolbar-hover-bg)] transition-colors cursor-pointer"
      >
        <span
          className="h-3.5 w-3.5 rounded-full border border-black/15 dark:border-white/20 transition-colors"
          style={{
            backgroundColor:
              selectedColor === 'default'
                ? 'var(--foreground)'
                : `var(--nd-icon-color-${selectedColor})`,
          }}
        />
      </button>
      {isOpen && (
        <div
          role="listbox"
          aria-label="Icon colors"
          // Explicit 1.5rem tracks, not `grid-cols-5`: this box is absolutely
          // positioned inside a 34px trigger, so `1fr` tracks would resolve
          // against that width and the 24px swatches would overflow the panel.
          className="absolute right-0 top-full z-50 mt-1 grid grid-cols-[repeat(5,1.5rem)] gap-1.5 rounded-md bg-card p-1.5 text-card-foreground ring-1 ring-foreground/10 shadow-md animate-in fade-in slide-in-from-top-1 duration-100"
        >
          {/* Swatches only: the palette is 10 colors, so it lays out as a 2x5
              grid. Each name lives on the option as its accessible label and
              tooltip, since a grid of colored dots has no visible text to name. */}
          {ICON_COLORS.map((colorOption) => {
            const isSelected = selectedColor === colorOption.id;
            return (
              <button
                key={colorOption.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-label={colorOption.label}
                title={colorOption.label}
                onClick={() => onSelect(colorOption.id)}
                style={{
                  backgroundColor:
                    colorOption.id === 'default'
                      ? 'var(--foreground)'
                      : `var(--nd-icon-color-${colorOption.id})`,
                }}
                // Selection is an outline *offset* rather than a tight ring:
                // the 2px gap is what reads as "chosen", and an outline takes
                // no layout space, so the 6px grid gap is untouched. Hover stays
                // a flush ring, so the two states are never confused.
                className={`h-6 w-6 rounded-full border border-black/15 dark:border-white/20 outline-offset-2 transition-shadow cursor-pointer ${
                  isSelected
                    ? '[outline:2px_solid_var(--nd-brand)]'
                    : 'hover:ring-2 hover:ring-foreground/25'
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
