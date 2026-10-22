'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

export interface AnchoredPanel {
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelStyle: React.CSSProperties;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Positions a floating panel under its trigger, clamped into the viewport and
 * flipped above the trigger when it would run past the bottom edge — the same
 * rules `AccessDropdown` applies, factored out for the page icon/cover pickers.
 *
 * Hand-rolled rather than pulled from a popover library because the app already
 * positions every other floating menu this way (fixed coordinates from the
 * trigger rect), and a library would add a dependency for one behaviour.
 */
export function useAnchoredPanel({
  width,
  align = 'left',
}: {
  width: number;
  align?: 'left' | 'right';
}): AnchoredPanel {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Fixed coordinates go stale when an overflow ancestor scrolls under the
  // panel (or the viewport resizes), leaving it floating away from its
  // trigger. Re-measure from the trigger rect so the panel tracks it.
  const measureCoords = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect || typeof window === 'undefined') {
      return null;
    }

    // The panel clamps to `min(width, 100vw - 2×margin)` (see PickerShell),
    // so clamp against the effective width: with the nominal 360px the max
    // left collapses to the margin on phones and the CSS shrink would
    // otherwise be the only thing keeping the panel on screen.
    const effectiveWidth = Math.min(width, window.innerWidth - VIEWPORT_MARGIN * 2);
    const preferredLeft = align === 'right' ? rect.right - effectiveWidth : rect.left;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - effectiveWidth - VIEWPORT_MARGIN);
    return {
      top: rect.bottom + ANCHOR_GAP,
      left: Math.min(Math.max(VIEWPORT_MARGIN, preferredLeft), maxLeft),
    };
  }, [align, width]);

  const open = useCallback(() => {
    setCoords(measureCoords());
    setIsOpen(true);
  }, [measureCoords]);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [close, isOpen, open]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      // Capture the way down so an enclosing panel cannot close first.
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  // Track the trigger while open: scrolling an overflow ancestor (e.g. the
  // editor content) or resizing moves the trigger under a position:fixed
  // panel. Capture phase catches ancestor scrolls, not just the viewport's.
  //
  // Scrolls that start *inside* the panel (the icon grid, a menu list) are
  // skipped: the trigger never moves under them, and re-measuring on every
  // wheel tick mints fresh coords that re-render the whole panel mid-scroll —
  // hundreds of icon buttons reconciled per tick, starving the very loads the
  // user is scrolling toward until they jiggle the scroll again.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const reposition = (event?: Event) => {
      if (!triggerRef.current) {
        setIsOpen(false);
        return;
      }
      const target = event?.target;
      if (target instanceof Node && panelRef.current?.contains(target)) {
        return;
      }
      const next = measureCoords();
      // Ancestor scrolls that leave the trigger in place (or a resize with no
      // movement) must not churn renders: identical coords keep their object.
      setCoords((prev) => {
        if (next === null) {
          return null;
        }
        return prev && prev.top === next.top && prev.left === next.left ? prev : next;
      });
    };

    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true });
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen, measureCoords]);

  // Vertical flip/clamp, measured after the panel has rendered.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) {
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.bottom <= window.innerHeight - VIEWPORT_MARGIN) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const above = triggerRect.top - ANCHOR_GAP - panelRect.height;
    const nextTop =
      above >= VIEWPORT_MARGIN
        ? above
        : Math.max(VIEWPORT_MARGIN, window.innerHeight - panelRect.height - VIEWPORT_MARGIN);

    // Post-render measurement: the early return above guarantees this only runs
    // when an adjustment is needed, so it cannot loop. Re-runs on coords so a
    // scroll/resize reposition still flips above the trigger when needed.
    setCoords((prev) => (prev && prev.top !== nextTop ? { ...prev, top: nextTop } : prev));
  }, [isOpen, coords]);

  const panelStyle: React.CSSProperties = coords
    ? {
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width: `min(${width}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
      }
    : {
        position: 'fixed',
        top: 0,
        left: 0,
        width: `min(${width}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
        visibility: 'hidden',
      };

  return { isOpen, triggerRef, panelRef, panelStyle, open, close, toggle };
}
