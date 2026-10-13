'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ImageIcon, Smile } from '@/icons';
import { PageCover } from '@/components/page/PageCover';
import { PageIcon } from '@/components/page/PageIcon';
import { IconPickerPanel } from '@/components/page/IconPickerPanel';
import { CoverPickerPanel } from '@/components/page/CoverPickerPanel';
import { PICKER_PANEL_WIDTH } from '@/components/page/PickerShell';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel.hook';
import type { DocumentCover, DocumentIcon } from '@/types/document.types';

const ACTION_BUTTON_CLASS_NAME = `
  inline-flex items-center gap-1.5 rounded-md px-2 py-1
  text-[13px] font-medium text-muted-foreground
  transition-colors duration-150 cursor-pointer
  hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground
  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
`;

export interface DocumentPageHeaderProps {
  documentId: string;
  title: string;
  icon?: DocumentIcon;
  cover?: DocumentCover;
  isReadOnly: boolean;
  /** Whether the reader may change the page icon/cover at all (EDIT or OWNER). */
  canEdit: boolean;
  /** Uploads additionally need a signed-in session (see `describeUploadBlockReason`). */
  canUpload: boolean;
  accessToken: string | null;
  onTitleChange: (title: string) => void;
  onTitleBlur: () => void;
  onTitleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelectIcon: (icon: DocumentIcon) => void;
  onRemoveIcon: () => void;
  onSelectCover: (cover: DocumentCover) => void;
  onRemoveCover: () => void;
  onCoverPositionChange: (position: number) => void;
}

/**
 * The top of a document: cover banner, page icon, title, and the two page-level
 * actions ("Add icon" / "Add cover") that stay out of the way until the title is
 * hovered or focused.
 *
 * Owns the title textarea because the icon, title and actions share one column
 * and one hover target; the editor only learns about title edits through
 * callbacks.
 */
export function DocumentPageHeader({
  documentId,
  title,
  icon,
  cover,
  isReadOnly,
  canEdit,
  canUpload,
  accessToken,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  onSelectIcon,
  onRemoveIcon,
  onSelectCover,
  onRemoveCover,
  onCoverPositionChange,
}: DocumentPageHeaderProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const iconPanel = useAnchoredPanel({ width: PICKER_PANEL_WIDTH, align: 'left' });
  const coverPanel = useAnchoredPanel({ width: PICKER_PANEL_WIDTH, align: 'right' });

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [title, adjustTextareaHeight]);

  useEffect(() => {
    // A brand-new document opens with the caret in the title.
    if (!isReadOnly && textareaRef.current && title === 'Untitled') {
      textareaRef.current.focus();
    }
    // Mount-only: later title changes are the reader's own typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="nd-page-header flex w-full flex-col">
      {cover && (
        <PageCover
          cover={cover}
          canEdit={canEdit}
          triggerRef={coverPanel.triggerRef}
          accessToken={accessToken}
          onRequestChange={coverPanel.toggle}
          onRemove={onRemoveCover}
          onPositionChange={onCoverPositionChange}
        />
      )}

      <div className="w-full max-w-4xl mx-auto px-2 sm:px-4">
        <div className="document-title-container group/title">
          {icon && (
            <div className={cover ? '-mt-10 mb-2 flex relative z-20' : 'mt-1 mb-1.5 flex'}>
              {/*
                No hover surface: the page icon is document content that also
                happens to be a button, and shading it on hover makes every pass
                of the pointer over it look like an edit affordance.
              */}
              <button
                type="button"
                ref={iconPanel.triggerRef}
                disabled={!canEdit}
                onClick={iconPanel.toggle}
                aria-label="Page icon"
                aria-haspopup="dialog"
                aria-expanded={iconPanel.isOpen}
                title={canEdit ? 'Change icon' : undefined}
                className="
                  -ml-1 inline-flex items-center justify-center rounded-lg p-1
                  transition-colors duration-150
                  disabled:cursor-default cursor-pointer
                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
                "
              >
                <PageIcon icon={icon} size={72} accessToken={accessToken} />
              </button>
            </div>
          )}

          {/*
            Hover-only on pointer devices, always visible on touch, which has no
            hover. Placed above title. The row is always rendered when editing
            so the title never jumps: full `min-h` while an action is offered,
            a slimmer spacer once icon and cover are both set and it is invisible.

            `-ml-2` borrows back each button's own `px-2` so the labels sit on the
            title's left edge rather than 8px inside it — the same trick the page
            icon button above plays with `-ml-1`, keeping the whole column flush.
          */}
          {canEdit && (
            <div
              className={`
                -ml-2 flex items-center gap-1 mb-1.5
                ${!icon || !cover ? 'min-h-[28px]' : 'min-h-[12px]'}
                ${cover ? 'mt-3' : ''}
                opacity-0 transition-opacity duration-150
                group-hover/title:opacity-100 group-focus-within/title:opacity-100 focus-within:opacity-100
                pointer-coarse:opacity-100
              `}
            >
              {!icon && (
                <button
                  type="button"
                  ref={iconPanel.triggerRef}
                  onClick={iconPanel.toggle}
                  aria-haspopup="dialog"
                  aria-expanded={iconPanel.isOpen}
                  className={ACTION_BUTTON_CLASS_NAME}
                >
                  <Smile size={15} />
                  Add icon
                </button>
              )}
              {!cover && (
                <button
                  type="button"
                  ref={coverPanel.triggerRef}
                  onClick={coverPanel.toggle}
                  aria-haspopup="dialog"
                  aria-expanded={coverPanel.isOpen}
                  className={ACTION_BUTTON_CLASS_NAME}
                >
                  <ImageIcon size={15} />
                  Add cover
                </button>
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={title === 'Untitled' ? '' : title}
            readOnly={isReadOnly}
            onChange={(event) => {
              onTitleChange(event.target.value);
              adjustTextareaHeight();
            }}
            onBlur={onTitleBlur}
            onKeyDown={onTitleKeyDown}
            placeholder="Untitled"
            className="document-title-input overflow-hidden"
            rows={1}
          />
        </div>
      </div>

      {iconPanel.isOpen && canEdit && (
        <IconPickerPanel
          icon={icon}
          documentId={documentId}
          accessToken={accessToken}
          canUpload={canUpload}
          panelRef={iconPanel.panelRef}
          panelStyle={iconPanel.panelStyle}
          onSelect={onSelectIcon}
          onRemove={onRemoveIcon}
          onClose={iconPanel.close}
        />
      )}

      {coverPanel.isOpen && canEdit && (
        <CoverPickerPanel
          documentId={documentId}
          accessToken={accessToken}
          canUpload={canUpload}
          panelRef={coverPanel.panelRef}
          panelStyle={coverPanel.panelStyle}
          onSelect={onSelectCover}
          onClose={coverPanel.close}
        />
      )}
    </div>
  );
}
