import { Settings, Users, Trash } from '@/icons';
import { PopupMenuItem } from '@/components/PopupMenuItem';
import { SidebarMenuSeparator, SidebarPopup } from './SidebarPopup';

export type WorkspaceMenuPopupProps = {
  theme: 'dark' | 'light';
  canManageMembers: boolean;
  onOpenWorkspaceSettings: () => void;
  onOpenPeople: () => void;
  onOpenTrash: () => void;
  style: React.CSSProperties;
  popupRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Workspace-scoped actions. Only signed-in members open it: guests have no
 * workspace, and the settings pages behind these items need a session.
 */
export function WorkspaceMenuPopup({
  theme,
  canManageMembers,
  onOpenWorkspaceSettings,
  onOpenPeople,
  onOpenTrash,
  style,
  popupRef,
}: WorkspaceMenuPopupProps) {
  return (
    <SidebarPopup theme={theme} label="Workspace options" style={style} popupRef={popupRef}>
      <PopupMenuItem
        theme={theme}
        icon={<Settings size={16} className="opacity-90" />}
        onClick={onOpenWorkspaceSettings}
      >
        Workspace settings
      </PopupMenuItem>
      <PopupMenuItem
        theme={theme}
        icon={<Users size={16} className="opacity-90" />}
        onClick={onOpenPeople}
      >
        {canManageMembers ? 'Manage people' : 'People'}
      </PopupMenuItem>
      <SidebarMenuSeparator />
      <PopupMenuItem
        theme={theme}
        icon={<Trash size={16} className="opacity-90" />}
        onClick={onOpenTrash}
      >
        Trash
      </PopupMenuItem>
    </SidebarPopup>
  );
}
