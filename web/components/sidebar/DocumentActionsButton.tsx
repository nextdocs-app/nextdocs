import { MoreHorizontal } from '@/icons';
import type { DocActionType } from './types';

export type DocumentActionsButtonProps = {
  documentId: string;
  documentTitle: string;
  actionType: DocActionType;
  isOpen: boolean;
  onToggle: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
};

export function DocumentActionsButton({
  documentId,
  documentTitle,
  actionType,
  isOpen,
  onToggle,
}: DocumentActionsButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Document actions for ${documentTitle || 'Untitled'}`}
      onClick={(event) => onToggle(event, documentId, actionType)}
      // Always visible on touch: there is no hover to reveal it there.
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8 items-center justify-center rounded-md text-sidebar-foreground/80 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground cursor-pointer pointer-coarse:opacity-100 ${
        isOpen ? 'opacity-100' : 'opacity-0 group-hover/doc:opacity-100 focus-visible:opacity-100'
      }`}
      data-doc-actions-root={documentId}
    >
      <MoreHorizontal className="opacity-80" />
    </button>
  );
}
