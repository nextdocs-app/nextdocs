import { Settings, Logout, Login, UserCircle, Sliders } from '@/icons';
import { PopupMenuItem } from '@/components/PopupMenuItem';
import { SidebarMenuSeparator, SidebarPopup } from './SidebarPopup';

export type ProfileMenuPopupProps = {
  theme: 'dark' | 'light';
  isAuthenticated: boolean;
  onOpenProfile: () => void;
  onOpenPreferences: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onSignIn: () => void;
  style: React.CSSProperties;
  popupRef: React.RefObject<HTMLDivElement | null>;
};

export function ProfileMenuPopup({
  theme,
  isAuthenticated,
  onOpenProfile,
  onOpenPreferences,
  onOpenSettings,
  onLogout,
  onSignIn,
  style,
  popupRef,
}: ProfileMenuPopupProps) {
  return (
    <SidebarPopup theme={theme} label="Account options" style={style} popupRef={popupRef}>
      <PopupMenuItem
        theme={theme}
        icon={<UserCircle size={16} className="opacity-90" />}
        onClick={onOpenProfile}
      >
        Profile
      </PopupMenuItem>
      <PopupMenuItem
        theme={theme}
        icon={<Sliders size={16} className="opacity-90" />}
        onClick={onOpenPreferences}
      >
        Preferences
      </PopupMenuItem>
      <SidebarMenuSeparator />
      <PopupMenuItem
        theme={theme}
        icon={<Settings size={16} className="opacity-90" />}
        onClick={onOpenSettings}
      >
        Settings
      </PopupMenuItem>
      <SidebarMenuSeparator />
      {isAuthenticated ? (
        <PopupMenuItem
          theme={theme}
          icon={<Logout size={16} className="opacity-90" />}
          onClick={onLogout}
        >
          Log out
        </PopupMenuItem>
      ) : (
        <PopupMenuItem theme={theme} icon={<Login className="opacity-90" />} onClick={onSignIn}>
          Log in
        </PopupMenuItem>
      )}
    </SidebarPopup>
  );
}
