import { useLayoutEffect, useRef, useState } from 'react';
import { Logout, Trash } from '@/icons';
import { PopupMenuItem } from '@/components/PopupMenuItem';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { computeMenuPosition, type MenuPosition } from '@/lib/menu-position.util';
import type { DocActionsAnchor } from './types';

export type DocumentActionsMenuProps = {
  anchor: DocActionsAnchor;
  resolvedTheme: string;
  onLeaveShared: (docId: string) => void | Promise<void>;
  onMoveToTrash: (docId: string) => void | Promise<void>;
};

export function DocumentActionsMenu({
  anchor,
  resolvedTheme,
  onLeaveShared,
  onMoveToTrash,
}: DocumentActionsMenuProps) {
  const isDark = resolvedTheme === 'dark';
  const menuRef = useRef<HTMLDivElement>(null);
  const isMobileLayout = useIsMobileLayout();
  const [position, setPosition] = useState<MenuPosition | null>(null);

  // The menu size is only knowable once it is in the DOM, so the final spot is
  // measured in a layout effect. Until then the menu stays hidden in place of
  // its trigger, which is never painted.
  useLayoutEffect(() => {
    const updatePosition = () => {
      const menu = menuRef.current;
      if (!menu) {
        return;
      }

      const { width, height } = menu.getBoundingClientRect();
      setPosition(
        computeMenuPosition({
          trigger: anchor.trigger,
          menu: { width, height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          anchorEdgeX: anchor.panelEdgeX,
          // Desktop has a page next to the rail, so the menu can straddle the
          // edge; the mobile drawer is nearly full-bleed, so the menu opens to the
          // right of it and the clamp keeps it inside the screen.
          alignment: isMobileLayout ? 'after-edge' : 'straddle',
        })
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchor, isMobileLayout]);

  return (
    <div
      ref={menuRef}
      data-doc-actions-root={anchor.documentId}
      data-placement={position?.placement}
      style={
        position
          ? { left: position.left, top: position.top }
          : { left: anchor.trigger.left, top: anchor.trigger.bottom, visibility: 'hidden' }
      }
      className={`fixed z-50 min-w-[11.5rem] rounded-sm border border-sidebar-border p-1.5 shadow-xl ${
        isDark ? 'bg-[#303030] text-white' : 'bg-popover text-popover-foreground'
      }`}
      role="menu"
      aria-label="Document actions"
    >
      <PopupMenuItem
        theme={isDark ? 'dark' : 'light'}
        icon={
          anchor.actionType === 'leave-shared' ? (
            <Logout className="opacity-90" />
          ) : (
            <Trash size={16} className="opacity-90" />
          )
        }
        onClick={(event) => {
          event.stopPropagation();
          if (anchor.actionType === 'leave-shared') {
            void onLeaveShared(anchor.documentId);
            return;
          }
          void onMoveToTrash(anchor.documentId);
        }}
        className={
          isDark ? 'text-white/90 hover:text-red-400' : 'text-popover-foreground hover:text-red-600'
        }
      >
        {anchor.actionType === 'leave-shared' ? 'Leave shared document' : 'Move to Trash'}
      </PopupMenuItem>
    </div>
  );
}
