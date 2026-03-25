/**
 * Block type definitions matching BlockNote's actual API.
 * Source: https://www.blocknotejs.org/docs/editor-basics/document-structure
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

// Source: https://www.blocknotejs.org/docs/features/blocks#default-block-properties
export interface DefaultBlockProps {
  textAlignment: TextAlignment;
  backgroundColor: string;
  textColor: string;
}

// Source: https://www.blocknotejs.org/docs/features/blocks/inline-content#default-styles
export interface Styles {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textColor: string;
}

// Source: https://www.blocknotejs.org/docs/features/blocks/inline-content#styled-text
export interface StyledText {
  type: 'text';
  text: string;
  styles: Styles;
}

// Source: https://www.blocknotejs.org/docs/features/blocks/inline-content#link
export interface Link {
  type: 'link';
  href: string;
  content: StyledText[];
}

export type InlineContent = StyledText | Link;

// Base properties for all blocks
interface BaseBlock {
  id: string;
  children: Block[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/typography#paragraph
export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph';
  props: DefaultBlockProps;
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/typography#heading
export interface HeadingBlock extends BaseBlock {
  type: 'heading';
  props: DefaultBlockProps & { level: HeadingLevel };
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/typography#quote
export interface QuoteBlock extends BaseBlock {
  type: 'quote';
  props: DefaultBlockProps;
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/list-types#bullet-list-item
export interface BulletListItemBlock extends BaseBlock {
  type: 'bulletListItem';
  props: DefaultBlockProps;
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/list-types#numbered-list-item
export interface NumberedListItemBlock extends BaseBlock {
  type: 'numberedListItem';
  props: DefaultBlockProps & { start?: number };
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/list-types#check-list-item
export interface CheckListItemBlock extends BaseBlock {
  type: 'checkListItem';
  props: DefaultBlockProps & { checked: boolean };
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/list-types#toggle-list-item
export interface ToggleListItemBlock extends BaseBlock {
  type: 'toggleListItem';
  props: DefaultBlockProps;
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/code-blocks
export interface CodeBlock extends BaseBlock {
  type: 'codeBlock';
  props: DefaultBlockProps & { language: string };
  content: InlineContent[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/embeds#file
export interface FileBlock extends BaseBlock {
  type: 'file';
  props: DefaultBlockProps & { name: string; url: string; caption: string };
  content: undefined;
}

// Source: https://www.blocknotejs.org/docs/features/blocks/embeds#image
export interface ImageBlock extends BaseBlock {
  type: 'image';
  props: DefaultBlockProps & {
    url: string;
    caption: string;
    previewWidth: number;
  };
  content: undefined;
}

// Source: https://www.blocknotejs.org/docs/features/blocks/embeds#video
export interface VideoBlock extends BaseBlock {
  type: 'video';
  props: DefaultBlockProps & {
    name: string;
    url: string;
    caption: string;
    showPreview: boolean;
    previewWidth?: number;
  };
  content: undefined;
}

// Source: https://www.blocknotejs.org/docs/features/blocks/embeds#audio
export interface AudioBlock extends BaseBlock {
  type: 'audio';
  props: DefaultBlockProps & {
    name: string;
    url: string;
    caption: string;
    showPreview: boolean;
  };
  content: undefined;
}

export interface TableCell {
  type: 'tableCell';
  props: DefaultBlockProps & { colspan?: number; rowspan?: number };
  content: InlineContent[];
}

export interface TableContent {
  type: 'tableContent';
  columnWidths: number[];
  headerRows: number;
  rows: { cells: TableCell[] }[];
}

// Source: https://www.blocknotejs.org/docs/features/blocks/tables#block-shape
export interface TableBlock extends BaseBlock {
  type: 'table';
  props: DefaultBlockProps;
  content: TableContent;
}

// Discriminated union of all block types
export type Block =
  | ParagraphBlock
  | HeadingBlock
  | QuoteBlock
  | BulletListItemBlock
  | NumberedListItemBlock
  | CheckListItemBlock
  | ToggleListItemBlock
  | CodeBlock
  | FileBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | TableBlock;

// Extract block type string union from Block
export type BlockType = Block['type'];

// Our extensions for document-level metadata (not part of BlockNote)
export interface DocumentMeta {
  title: string;
  icon?: string;
  coverImage?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  deletedAt?: string;
  purgeAt?: string;
}

export interface Document {
  id: string;
  meta: DocumentMeta;
  blocks: Block[];
}

// Y.Doc shared type keys
export const Y_DOC_KEYS = {
  META: 'meta',
  BLOCKS: 'blocks',
  AWARENESS: 'awareness',
} as const;
