import type { MouseEventHandler, ReactNode } from 'react';

type PopupMenuItemProps = {
  icon: ReactNode;
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  theme: 'dark' | 'light';
  className?: string;
  role?: 'menuitem';
  disabled?: boolean;
  title?: string;
};

const baseClassName =
  'w-full rounded-sm px-2 py-1.5 text-left text-[14px] transition-colors flex items-center gap-2';

const iconSlotClassName = 'inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center';

export function PopupMenuItem({
  icon,
  children,
  onClick,
  theme,
  className,
  role = 'menuitem',
  disabled = false,
  title,
}: PopupMenuItemProps) {
  const hoverClassName = theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-foreground/[0.07]';

  return (
    <button
      type="button"
      role={role}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${baseClassName} ${
        disabled ? 'cursor-not-allowed opacity-50' : `cursor-pointer ${hoverClassName}`
      } ${className ?? ''}`}
    >
      <span className={iconSlotClassName}>{icon}</span>
      {children}
    </button>
  );
}
