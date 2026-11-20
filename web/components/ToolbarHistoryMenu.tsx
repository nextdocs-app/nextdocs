'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { History, MoreHorizontal } from '@/icons/index';
import { PopupMenuItem } from '@/components/PopupMenuItem';
import { Portal } from '@/components/Portal';
import { SidebarPopup } from '@/components/sidebar/SidebarPopup';
import { useDismissableMenu } from '@/components/sidebar/useDismissableMenu';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { useTheme } from '@/hooks/useTheme.hook';
import { computeMenuPosition, type MenuPosition } from '@/lib/menu-position.util';

// The toolbar is server-rendered and the menu opens on a click, so the layout
// effect only exists to measure before paint in the browser.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type ToolbarHistoryMenuProps = {
  /** Whether version history can be opened (online, not trashed, signed in). */
  canViewVersionHistory: boolean;
  onVersionHistoryToggle?: () => void;
};

/**
 * The document toolbar's actions menu. It is placed with the sidebar's rules:
 * measured while hidden, then pinned below the trigger and clamped to the
 * viewport. On desktop the straddle clamp keeps it right-aligned with the
 * trigger; on the mobile layout the after-edge branch does the same without
 * crossing the screen edge.
 */
export function ToolbarHistoryMenu({
  canViewVersionHistory,
  onVersionHistoryToggle,
}: ToolbarHistoryMenuProps) {
  const { resolvedTheme } = useTheme();
  const isMobileLayout = useIsMobileLayout();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useDismissableMenu({
    isOpen,
    triggerRef: buttonRef,
    popupRef: menuRef,
    onDismiss: () => setIsOpen(false),
  });

  useIsomorphicLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const updatePosition = () => {
      const trigger = buttonRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const { width, height } = menu.getBoundingClientRect();
      setPosition(
        computeMenuPosition({
          trigger: triggerRect,
          menu: { width, height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          anchorEdgeX: triggerRect.right,
          alignment: isMobileLayout ? 'after-edge' : 'straddle',
        })
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, isMobileLayout]);

  return (
    <div className="relative flex items-center">
      <button
        ref={buttonRef}
        id="doc-more-btn"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="More document actions"
        title="More document actions"
        className={[
          'inline-flex items-center justify-center rounded-sm transition-colors duration-150',
          'h-9 w-9 md:h-[30px] md:w-[30px]',
          isOpen
            ? 'text-primary bg-[var(--nd-toolbar-hover-bg)]'
            : 'text-foreground hover:text-primary hover:bg-[var(--nd-toolbar-hover-bg)]',
          'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        ].join(' ')}
      >
        <MoreHorizontal />
      </button>

      {isOpen && (
        <Portal>
          <SidebarPopup
            theme={resolvedTheme}
            label="Document actions"
            style={position ?? { visibility: 'hidden' }}
            popupRef={menuRef}
          >
            <PopupMenuItem
              theme={resolvedTheme}
              disabled={!canViewVersionHistory}
              title={
                canViewVersionHistory
                  ? 'View and restore earlier versions'
                  : 'Version history is available while this document is online and not in the trash'
              }
              icon={<History size={16} className="opacity-90" />}
              onClick={() => {
                if (!canViewVersionHistory) return;
                setIsOpen(false);
                onVersionHistoryToggle?.();
              }}
            >
              Version history
            </PopupMenuItem>
          </SidebarPopup>
        </Portal>
      )}
    </div>
  );
}
