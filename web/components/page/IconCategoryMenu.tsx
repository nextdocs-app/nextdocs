'use client';

import { ChevronDown } from '@/icons';
import type { IconCatalogCategory } from '@/hooks/useIconCatalog.hook';
import { pickerInputClassName } from '@/components/page/PickerShell';

/**
 * Builtin icon category dropdown.
 *
 * A native `<select>` is out of the question here: Chrome renders its option
 * popup with OS chrome that ignores the app theme (white in dark mode), and
 * its chevron cannot be positioned. This follows the `IconColorMenu` language
 * instead — a themed button with an explicit trailing chevron and a popover
 * listbox — so the control reads as part of the same family.
 */
export function IconCategoryMenu({
  categories,
  activeCategory,
  isOpen,
  menuRef,
  onToggle,
  onSelect,
}: {
  categories: IconCatalogCategory[];
  activeCategory: string;
  isOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onSelect: (categoryId: string) => void;
}) {
  const active = categories.find((category) => category.id === activeCategory);
  const total = categories.reduce((sum, category) => sum + category.icons.length, 0);
  const options = [
    { id: 'all', label: 'All categories', count: total },
    ...categories.map((category) => ({
      id: category.id,
      label: category.label,
      count: category.icons.length,
    })),
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label={`Icon category: ${active ? active.label : 'All categories'}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={`flex cursor-pointer items-center gap-2 text-left ${pickerInputClassName}`}
      >
        <span className="min-w-0 flex-1 truncate">{active ? active.label : 'All categories'}</span>
        <ChevronDown size={14} className="flex-shrink-0 text-muted-foreground/70" />
      </button>
      {isOpen && (
        <div
          role="listbox"
          aria-label="Icon categories"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md bg-card p-1 text-card-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in slide-in-from-top-1 duration-100"
        >
          {options.map((option) => {
            const isSelected =
              option.id === 'all' ? activeCategory === 'all' : active?.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(option.id)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors ${
                  isSelected
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground hover:bg-[var(--nd-toolbar-hover-bg)]'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                <span className="flex-shrink-0 text-[11px] text-muted-foreground/70">
                  {option.count}
                </span>
                {isSelected && <span className="text-[11px] text-primary">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
