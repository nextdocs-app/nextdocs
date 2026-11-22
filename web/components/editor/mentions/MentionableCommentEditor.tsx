'use client';

import {
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  getFormattingToolbarItems,
  useBlockNoteContext,
  type ComponentProps,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { useMemo } from 'react';
import { MentionSuggestionMenu } from './MentionSuggestionMenu';
import { useMentionConfig } from './MentionConfigContext';
import { createMentionMenuItems } from './mention-menu';

/**
 * The formatting toolbar the stock comment editor draws: no block-type select and no
 * nest/unnest buttons. It is declared here because the view below is rendered by this
 * component rather than by `@blocknote/shadcn`'s `Comments.Editor`.
 */
function CommentFormattingToolbar() {
  const items = getFormattingToolbarItems([]).filter(
    (item) => item.key !== 'nestBlockButton' && item.key !== 'unnestBlockButton'
  );
  return <FormattingToolbar blockTypeSelectItems={[]}>{items}</FormattingToolbar>;
}

/**
 * The shadcn comment editor plus the `@` suggestion menu.
 *
 * BlockNote's comment editors are separate editor instances, so the document view's
 * `SuggestionMenuController` cannot serve them: it would open on the page editor's
 * cursor. The controller has to render inside the comment's own `BlockNoteView`, because
 * that view is what provides the context it mutates — the comment editor instance and
 * the comment contenteditable's `setContentEditableProps`, which carries the menu's
 * aria wiring. A provider of our own outside the view would keep pointing those at the
 * page editor, so this renders the stock comment view with one child added instead. The
 * toolbar, submit-on-enter and read-only bodies are unchanged.
 */
export function MentionableCommentEditor({
  className,
  autoFocus,
  editable,
  editor,
  onFocus,
  onBlur,
}: ComponentProps['Comments']['Editor']) {
  const parentContext = useBlockNoteContext();
  const mentionConfig = useMentionConfig();

  const mentionItems = useMemo(
    () => (mentionConfig ? createMentionMenuItems(editor, mentionConfig) : undefined),
    [editor, mentionConfig]
  );

  return (
    <BlockNoteView
      autoFocus={autoFocus}
      className={className}
      theme={parentContext?.colorSchemePreference}
      editor={editor}
      sideMenu={false}
      slashMenu={false}
      tableHandles={false}
      filePanel={false}
      formattingToolbar={false}
      editable={editable}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <FormattingToolbarController formattingToolbar={CommentFormattingToolbar} />
      {editable && mentionConfig?.enabled && mentionItems ? (
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={mentionItems}
          suggestionMenuComponent={MentionSuggestionMenu}
        />
      ) : null}
    </BlockNoteView>
  );
}
