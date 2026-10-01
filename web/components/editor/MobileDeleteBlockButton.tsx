'use client';

import { useBlockNoteEditor, useComponentsContext, useDictionary } from '@blocknote/react';
import { useCallback } from 'react';
import { Trash } from '@/icons';

/**
 * The mobile formatting toolbar's delete-block button.
 *
 * Deleting a block is a mouse affordance on desktop: it lives in the side menu's
 * drag-handle menu (BlockNote's own `RemoveBlockItem`), and touch devices render
 * no side menu at all (see EditorContent). The docked bar is the only chrome
 * that is always a tap away, so the action lives here.
 *
 * It deletes the block the text cursor sits in — the block the bar is otherwise
 * describing. `getTextCursorPosition()` is what names it, and not
 * `getSelection().blocks`: the bar is up for a collapsed cursor too, where there
 * is no selection to read, and a block merely *inside* a selection is not the
 * one the cursor is in. The position outlives the tap that blurs the
 * contenteditable — every button beside it is used with the caret already gone —
 * so it still names the same block by the time the click lands.
 *
 * Unlike the add-block button, this one refocuses afterwards. There is no menu
 * to free the keyboard's space for, and letting the caret drop would take the
 * keyboard — and this bar with it — down on an action the user is likely to
 * repeat, leaving them to tap back into the document between deletions. The
 * click is a user gesture, so the refocus is allowed to bring the keyboard back
 * up. BlockNote moves the cursor to the block that followed the deleted one
 * (and leaves an empty paragraph behind when the document would otherwise have
 * no blocks), which is where the text and the caret both belong.
 */
export function MobileDeleteBlockButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  // The same wording as the drag-handle menu's delete item, since this is the
  // only remaining way to reach that action on touch.
  const dict = useDictionary();

  const onClick = useCallback(() => {
    // `removeBlocks` leaves the block gone, so the position has to be read
    // first.
    const cursor = editor.getTextCursorPosition();
    if (!cursor?.block?.id) {
      return;
    }

    editor.removeBlocks([cursor.block.id]);
    editor.focus();
  }, [editor]);

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test="mobileDeleteBlockButton"
      label={dict.drag_handle.delete_menuitem}
      mainTooltip={dict.drag_handle.delete_menuitem}
      icon={<Trash size={17} />}
      onClick={onClick}
    />
  );
}
