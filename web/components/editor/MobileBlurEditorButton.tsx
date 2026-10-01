'use client';

import { useBlockNoteEditor, useComponentsContext } from '@blocknote/react';
import { useCallback } from 'react';
import { EditOff } from '@/icons';

/**
 * The mobile formatting toolbar's dismiss-editing button.
 *
 * Blurring the contenteditable drops the caret and, with it, the on-screen
 * keyboard — the only way to get the viewport back on a phone while the docked
 * bar is up, since the bar hides as soon as the editor loses the cursor.
 *
 * It is rendered as a direct child of the bar, beside the scrolling row (see
 * `MobileFormattingToolbarController`), so it can never scroll away: no sticky
 * positioning, no drift with the row's scrollport, always pinned at the right
 * edge. The row is what scrolls; this button is fixed relative to the bar.
 */
export function MobileBlurEditorButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;

  const onClick = useCallback(
    // `Components` types the handler against React's broad `MouseEvent`, whose
    // `currentTarget` is a bare `Element`; the render target is a button, and
    // `blur` needs the HTMLElement interface.
    (event: React.MouseEvent<Element>) => {
      // Tapping a button gives it focus, and the controller reads focus inside
      // the bar as "still editing" to stop the bar hiding under the finger. So
      // the button has to give that focus up itself, or blurring the editor
      // would leave the bar up over a caret-less document — the exact state the
      // button exists to leave behind.
      (event.currentTarget as HTMLElement).blur();
      editor.blur();
    },
    [editor]
  );

  return (
    <Components.Generic.Toolbar.Button
      className="bn-button bn-blur-editor-button"
      data-test="mobileBlurEditorButton"
      label="Dismiss keyboard"
      mainTooltip="Dismiss keyboard"
      icon={<EditOff size={17} />}
      onClick={onClick}
    />
  );
}
