import type { CSSProperties, ReactNode, RefObject } from 'react';

type SidebarPopupProps = {
  theme: 'dark' | 'light';
  /** Accessible name; also identifies the menu in tests. */
  label: string;
  style: CSSProperties;
  popupRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

/**
 * The rail's floating menu surface. Both menu contents are wrapped in it so
 * width, elevation and theming stay identical instead of being copied per menu.
 */
export function SidebarPopup({ theme, label, style, popupRef, children }: SidebarPopupProps) {
  return (
    <div
      ref={popupRef}
      style={style}
      className={`fixed text-[15px] z-50 rounded-lg border border-sidebar-border p-1.5 shadow-xl ${
        theme === 'dark' ? 'bg-[#303030] text-white' : 'bg-popover text-popover-foreground'
      }`}
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
