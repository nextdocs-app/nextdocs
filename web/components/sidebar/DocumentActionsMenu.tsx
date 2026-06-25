import { Logout, Trash } from '@/icons';
import { PopupMenuItem } from '@/components/PopupMenuItem';
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

  return (
    <div
      data-doc-actions-root={anchor.documentId}
      style={{ left: anchor.x, top: anchor.y }}
      className={`fixed z-50 min-w-[11.5rem] -translate-y-1/2 rounded-sm border border-sidebar-border p-1.5 shadow-xl ${
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
            <Trash size={15} className="opacity-90" />
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
