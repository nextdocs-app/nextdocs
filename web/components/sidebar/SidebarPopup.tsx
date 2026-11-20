import type { CSSProperties, ReactNode, RefObject } from 'react';
import { menuSurfaceClassName } from '@/components/menu-surface';

const sidebarMenuThemeClassName = {
  dark: 'bg-[#303030] text-white',
  light: 'bg-popover text-popover-foreground',
} as const;

type SidebarPopupProps = {
  theme: 'dark' | 'light';
  /** Accessible name; also identifies the menu in tests. */
  label: string;
  style: CSSProperties;
  popupRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  /** Extra data-* hooks used by the rail to track its document menu. */
  dataAttributes?: Record<`data-${string}`, string | undefined>;
};

export function SidebarPopup({
  theme,
  label,
  style,
  popupRef,
  children,
  dataAttributes,
}: SidebarPopupProps) {
  return (
    <div
      {...dataAttributes}
      ref={popupRef}
      style={style}
      className={`fixed z-50 ${menuSurfaceClassName} ${sidebarMenuThemeClassName[theme]}`}
      role="menu"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function SidebarMenuSeparator() {
  return <div role="separator" className="my-1 border-t border-sidebar-border" />;
}
