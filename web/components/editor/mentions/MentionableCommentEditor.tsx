'use client';

import {
  BlockNoteContext,
  SuggestionMenuController,
  useBlockNoteContext,
  type ComponentProps,
} from '@blocknote/react';
import { useMemo } from 'react';
import { components as shadcnComponents } from '@blocknote/shadcn';
import { MentionSuggestionMenu } from './MentionSuggestionMenu';
import { useMentionConfig } from './MentionConfigContext';
import { createMentionMenuItems } from './mention-menu';

const ShadCNCommentEditor = shadcnComponents.Comments.Editor;

/**
 * The shadcn comment editor plus the `@` suggestion menu.
 *
 * BlockNote's comment editors are separate editor instances, so the document
 * view's `SuggestionMenuController` cannot serve them. The editor prop gives us the
 * composer instance; binding the controller through `BlockNoteContext` points it at
 * that instance instead of the page editor. The rest of the shadcn comment UI is
 * untouched, so formatting, submit-on-enter, and read-only bodies behave as before.
 */
export function MentionableCommentEditor(props: ComponentProps['Comments']['Editor']) {
  const parentContext = useBlockNoteContext();
  const mentionConfig = useMentionConfig();
  const { editor, editable } = props;

  const mentionItems = useMemo(
    () => (mentionConfig ? createMentionMenuItems(editor, mentionConfig) : undefined),
    [editor, mentionConfig]
  );

  return (
    <BlockNoteContext.Provider value={{ ...parentContext, editor }}>
      <ShadCNCommentEditor {...props} />
      {editable && mentionConfig?.enabled && mentionItems ? (
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={mentionItems}
          suggestionMenuComponent={MentionSuggestionMenu}
        />
      ) : null}
    </BlockNoteContext.Provider>
  );
}
