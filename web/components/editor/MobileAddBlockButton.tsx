'use client';

import { SuggestionMenu } from '@blocknote/core/extensions';
import {
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
} from '@blocknote/react';
import { useCallback } from 'react';
import { Plus } from '@/icons';

/**
 * The mobile formatting toolbar's add-block button. It opens the same slash menu
 * the side menu's "+" opens on desktop, which is how blocks get added on touch:
 * touch devices render no side menu at all (see EditorContent).
 *
 * BlockNote's own `AddBlockButton` cannot be reused here — it reads the block to
 * insert next to from the side-menu extension state, which is only populated
 * while that menu is tracking a block.
 *
 * The menu opens over a blurred editor, so it lays itself out in the space the
 * on-screen keyboard was holding instead of fighting it for room. That is the
 * trade the block-type and colour dropdowns already make: tapping a toolbar
 * button takes focus off the contenteditable, and the keyboard goes with it.
 * BlockNote refocuses the editor when an item is picked, so the keyboard comes
 * straight back with the new block.
 */
export function MobileAddBlockButton() {
  // Only core block APIs are used here, so the default schema types are enough.
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const suggestionMenu = useExtension(SuggestionMenu);

  // `openSuggestionMenu` focuses the editor before it opens the menu, and
  // focusing the contenteditable is what brings the keyboard back up. Dispatch
  // the transaction it would instead — `closeMenu` writes the same meta, so
  // this is the extension's own mechanism, minus the focus.
  const openSlashMenu = useCallback(() => {
    // The menu is anchored to a decoration the plugin renders for its state;
    // the plugin is how `openSuggestionMenu` gets at it too.
    const trigger = suggestionMenu.prosemirrorPlugins?.[0]?.spec.key;

    if (trigger === undefined) {
      // The plugin is BlockNote's internal detail. If an upgrade hides it, the
      // public API still opens the menu; it just keeps the keyboard.
      suggestionMenu.openSuggestionMenu('/');
      return;
    }

    editor.transact((tr) =>
      tr.scrollIntoView().setMeta(trigger, {
        triggerCharacter: '/',
        deleteTriggerCharacter: false,
        ignoreQueryLength: false,
      })
    );
  }, [editor, suggestionMenu]);

  const onClick = useCallback(() => {
    const currentBlock = editor.getTextCursorPosition().block;
    const currentBlockIsEmpty =
      Array.isArray(currentBlock.content) && currentBlock.content.length === 0;

    if (currentBlockIsEmpty) {
      editor.setTextCursorPosition(currentBlock);
    } else {
      // Matches the side menu's add-block button: an empty paragraph below the
      // block the cursor sits in, so the picked type lands on a line of its own
      // rather than rewriting the block being edited.
      const insertedBlock = editor.insertBlocks([{ type: 'paragraph' }], currentBlock, 'after')[0];
      editor.setTextCursorPosition(insertedBlock);
    }

    // The tap has already taken focus off the contenteditable on most mobile
    // browsers; blurring makes it deterministic. It has to land *before* the
    // menu exists, because the suggestion plugin drops its state for any
    // transaction carrying tiptap's `blur` meta — which is what a later blur
    // would be.
    editor.blur();
    openSlashMenu();
  }, [editor, openSlashMenu]);

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test="mobileAddBlockButton"
      label={dict.side_menu.add_block_label}
      mainTooltip={dict.side_menu.add_block_label}
      icon={<Plus size={17} />}
      onClick={onClick}
    />
  );
}
