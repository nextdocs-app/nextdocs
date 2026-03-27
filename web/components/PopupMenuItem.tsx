import type { MouseEventHandler, ReactNode } from 'react';

type PopupMenuItemProps = {
  icon: ReactNode;
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  theme: 'dark' | 'light';
  className?: string;
  role?: 'menuitem';
};

const baseClassName =
  'w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors cursor-pointer flex items-center gap-2';

const iconSlotClassName = 'inline-flex h-4 w-4 flex-shrink-0 items-center justify-center';

export function PopupMenuItem({
  icon,
  children,
  onClick,
  theme,
  className,
  role = 'menuitem',
}: PopupMenuItemProps) {
  const hoverClassName = theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-foreground/[0.07]';

  return (
    <button
      type="button"
      role={role}
      onClick={onClick}
      className={`${baseClassName} ${hoverClassName} ${className ?? ''}`}
    >
      <span className={iconSlotClassName}>{icon}</span>
      {children}
    </button>
  );
}
