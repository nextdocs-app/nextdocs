'use client';

import {
  mergeCSSClasses,
  type BlockSchema,
  type InlineContentSchema,
  type StyleSchema,
} from '@blocknote/core';
import { BlockNoteViewRaw, ComponentsContext, type Components } from '@blocknote/react';
import {
  ShadCNComponentsContext,
  ShadCNDefaultComponents,
  components as shadcnComponents,
  type ShadCNComponents,
} from '@blocknote/shadcn';
import { useMemo } from 'react';
import { MentionableCommentEditor } from './MentionableCommentEditor';
import { MentionConfigProvider, type MentionConfig } from './MentionConfigContext';

/**
 * The shadcn `BlockNoteView` with one component swapped: the comment editor.
 *
 * `@blocknote/shadcn` hard-codes its component map, so overriding `shadCNComponents`
 * only replaces primitives (buttons, popovers). Mentions need `Comments.Editor`,
 * which is part of that map. Reproducing the view here is the smallest seam that
 * keeps every other shadcn component identical while letting comment composers bind
 * their own `@` menu.
 */
const componentsWithMentions: Components = {
  ...shadcnComponents,
  Comments: {
    ...shadcnComponents.Comments,
    Editor: MentionableCommentEditor,
  },
};

export function BlockNoteViewWithMentions<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>({
  className,
  shadCNComponents,
  mentionConfig,
  ...rest
}: React.ComponentProps<typeof BlockNoteViewRaw<BSchema, ISchema, SSchema>> & {
  shadCNComponents?: Partial<ShadCNComponents>;
  mentionConfig: MentionConfig;
}) {
  const componentsValue = useMemo(
    () => ({
      ...ShadCNDefaultComponents,
      ...shadCNComponents,
    }),
    [shadCNComponents]
  );

  return (
    <MentionConfigProvider value={mentionConfig}>
      <ShadCNComponentsContext.Provider value={componentsValue}>
        <ComponentsContext.Provider value={componentsWithMentions}>
          <BlockNoteViewRaw className={mergeCSSClasses('bn-shadcn', className || '')} {...rest} />
        </ComponentsContext.Provider>
      </ShadCNComponentsContext.Provider>
    </MentionConfigProvider>
  );
}
