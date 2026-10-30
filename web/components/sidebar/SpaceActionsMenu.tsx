'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Settings, Users } from '@/icons';
import { PopupMenuItem } from '@/components/PopupMenuItem';
import { Portal } from '@/components/Portal';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { computeMenuPosition, type MenuPosition } from '@/lib/menu-position.util';
import type { SpaceActionsAnchor } from './types';

export type SpaceActionsMenuProps = {
  anchor: SpaceActionsAnchor;
  spaceName: string;
  theme: 'dark' | 'light';
  /** Owners and workspace admins manage the roster; everyone else only reads it. */
  canAdminister: boolean;
  onOpenMembers: () => void;
  onOpenSettings: () => void;
};

/**
 * One space's actions. Portalled and positioned like the document menu, so the
 * scrolling rail can neither clip it nor capture its fixed coordinates, and the
 * mobile drawer's transform cannot drag it off screen.
 */
export function SpaceActionsMenu({
  anchor,
  spaceName,
  theme,
  canAdminister,
  onOpenMembers,
  onOpenSettings,
}: SpaceActionsMenuProps) {
  const isDark = theme === 'dark';
  const menuRef = useRef<HTMLDivElement>(null);
  const isMobileLayout = useIsMobileLayout();
  const [position, setPosition] = useState<MenuPosition | null>(null);

  // The menu's size is only knowable in the DOM, so the final spot is measured
  // in a layout effect; until then it stays invisible in place of its trigger.
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
    <Portal>
      <div
        ref={menuRef}
        data-space-actions-root={anchor.spaceId}
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
        aria-label={`${spaceName} options`}
      >
        <PopupMenuItem
          theme={isDark ? 'dark' : 'light'}
          icon={<Users size={16} className="opacity-90" />}
          onClick={(event) => {
            event.stopPropagation();
            onOpenMembers();
          }}
        >
          {canAdminister ? 'Manage members' : 'View members'}
        </PopupMenuItem>
        <PopupMenuItem
          theme={isDark ? 'dark' : 'light'}
          icon={<Settings size={16} className="opacity-90" />}
          onClick={(event) => {
            event.stopPropagation();
            onOpenSettings();
          }}
        >
          Space settings
        </PopupMenuItem>
      </div>
    </Portal>
  );
}
