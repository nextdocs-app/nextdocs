'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from '@/icons';
import { ACCESS_LABELS, type DropdownOption } from './shareOptions';

export type { DropdownOption };

const MENU_MARGIN = 8;
const MENU_MIN_WIDTH = 192; // matches min-w-[12rem]

export function AccessDropdown<T extends string>({
  value,
  options,
  onChange,
  disabled,
  align = 'right',
  ariaLabel,
  muted = false,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (val: T) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
  ariaLabel?: string;
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  const handleOpen = () => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Keep the menu on-screen horizontally: clamp the anchor edge so the
      // menu (min-w-[12rem]) never runs past the viewport.
      const maxEdge = Math.max(MENU_MARGIN, window.innerWidth - MENU_MIN_WIDTH - MENU_MARGIN);
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(MENU_MARGIN, Math.min(rect.left, maxEdge)),
        right: Math.max(MENU_MARGIN, Math.min(window.innerWidth - rect.right, maxEdge)),
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase (see addEventListener below): the panel's own
        // document-level Escape handler is registered first (bubble), so a
        // bubble-phase handler here would run second — after the panel
        // already closed. Intercepting on the way down wins regardless of
        // registration order; preventDefault also signals same-target
        // handlers via defaultPrevented.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Keep the open menu on-screen vertically: flip above the trigger when it
  // would run past the viewport bottom (easy to hit on mobile), else clamp.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom <= window.innerHeight - MENU_MARGIN) return;
    const triggerRect = trigger.getBoundingClientRect();
    const above = triggerRect.top - menuRect.height - 4;
    const nextTop =
      above >= MENU_MARGIN
        ? above
        : Math.max(MENU_MARGIN, window.innerHeight - menuRect.height - MENU_MARGIN);
    // Post-render DOM measurement: the early return above guarantees this
    // only runs when an adjustment is needed, so it never loops.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCoords((prev) => (prev.top === nextTop ? prev : { ...prev, top: nextTop }));
  }, [open]);

  const isDestructive = value === 'NO_ACCESS';

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        aria-label={ariaLabel || selected?.label || ACCESS_LABELS[value] || value}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`
          inline-flex items-center gap-1.5 rounded-md px-2 py-1
          text-[13px] font-medium
          ${
            isDestructive
              ? 'text-destructive dark:text-red-400'
              : muted
                ? 'text-muted-foreground/80'
                : 'text-foreground'
          }
          hover:bg-sidebar-accent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors cursor-pointer select-none
          outline-none focus-visible:ring-1 focus-visible:ring-ring
        `}
      >
        <span>{selected?.label ?? ACCESS_LABELS[value] ?? value}</span>
        <ChevronDown
          size={13}
          className={`h-3.5 w-3.5 flex-shrink-0 ${
            isDestructive
              ? 'text-destructive dark:text-red-400'
              : muted
                ? 'text-muted-foreground/80'
                : 'text-muted-foreground'
          } transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          style={
            align === 'right'
              ? {
                  position: 'fixed',
                  top: coords.top,
                  right: coords.right,
                  maxWidth: `calc(100vw - ${coords.right}px - ${MENU_MARGIN}px)`,
                }
              : {
                  position: 'fixed',
                  top: coords.top,
                  left: coords.left,
                  maxWidth: `calc(100vw - ${coords.left}px - ${MENU_MARGIN}px)`,
                }
          }
          className="
            z-[9999] min-w-[12rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-1rem)]
            rounded-xl border border-border dark:border-white/10 bg-card text-card-foreground
            shadow-[0_8px_24px_-4px_rgba(0,0,0,0.12),0_2px_6px_-2px_rgba(0,0,0,0.08)]
            dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.55)]
            py-1.5 overflow-x-hidden overflow-y-auto
            animate-in fade-in slide-in-from-top-1 duration-100
          "
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div key={opt.value}>
                {opt.dividerBefore && (
                  <div
                    role="separator"
                    className="my-1 border-t border-border/70 dark:border-white/10"
                  />
                )}
                <button
                  type="button"
                  role="option"
                  aria-label={opt.label}
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 text-left
                    text-[13px] cursor-pointer transition-colors
                    ${
                      opt.isDestructive
                        ? 'text-destructive dark:text-red-400 hover:bg-destructive/10 dark:hover:bg-red-500/10'
                        : 'text-card-foreground hover:bg-sidebar-accent'
                    }
                    ${isSelected ? 'font-medium bg-sidebar-accent/50' : 'font-normal'}
                  `}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                    )}
                  </div>
                  {isSelected && (
                    <Check size={14} className="h-3.5 w-3.5 text-foreground flex-shrink-0 ml-2" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
