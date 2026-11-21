import {
  BlockNoteSchema,
  createParagraphBlockSpec,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import { UserMention } from './UserMention';

// Keep the default comment schema's narrower style set: comments are a short
// plain-text discussion, not a page, so text/background colours stay out. Listing the
// styles explicitly keeps the omission visible and leaves no unused destructured names.
const commentStyleSpecs = {
  bold: defaultStyleSpecs.bold,
  italic: defaultStyleSpecs.italic,
  underline: defaultStyleSpecs.underline,
  strike: defaultStyleSpecs.strike,
  code: defaultStyleSpecs.code,
};

/**
 * The schema used by BlockNote's comment composers and read-only comment bodies.
 *
 * It mirrors `@blocknote/react`'s default comment schema (one paragraph block, the
 * default inline content and styles) and adds the user mention so a comment can carry
 * the same inline content as the document body.
 */
export const commentEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: createParagraphBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: UserMention,
  },
  styleSpecs: commentStyleSpecs,
});
