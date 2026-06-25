import { Settings, Trash, Logout, Login } from '@/icons';
import { PopupMenuItem } from '@/components/PopupMenuItem';

export type ProfileMenuPopupProps = {
  theme: 'dark' | 'light';
  isAuthenticated: boolean;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  onLogout: () => void;
  onOpenAuth: () => void;
  style: React.CSSProperties;
  popupRef: React.RefObject<HTMLDivElement | null>;
};

export function ProfileMenuPopup({
  theme,
  isAuthenticated,
  onOpenSettings,
  onOpenTrash,
  onLogout,
  onOpenAuth,
  style,
  popupRef,
}: ProfileMenuPopupProps) {
  return (
    <div
      ref={popupRef}
      style={style}
      className={`fixed w-[14.9rem] text-[14px] z-30 rounded-lg border border-sidebar-border p-1.5 ${
        theme === 'dark' ? 'bg-[#303030] text-white' : 'bg-popover text-popover-foreground'
      }`}
      role="menu"
      aria-label="Account options"
    >
      <PopupMenuItem
        theme={theme}
        icon={<Settings size={15} className="opacity-90" />}
        onClick={onOpenSettings}
      >
        Settings
      </PopupMenuItem>
      {isAuthenticated && (
        <PopupMenuItem
          theme={theme}
          icon={<Trash size={15} className="opacity-90" />}
          onClick={onOpenTrash}
        >
          Trash Documents
        </PopupMenuItem>
      )}
      {isAuthenticated ? (
        <PopupMenuItem
          theme={theme}
          icon={<Logout size={15} className="opacity-90" />}
          onClick={onLogout}
        >
          Log out
        </PopupMenuItem>
      ) : (
        <PopupMenuItem theme={theme} icon={<Login className="opacity-90" />} onClick={onOpenAuth}>
          Log in
        </PopupMenuItem>
      )}
    </div>
  );
}
