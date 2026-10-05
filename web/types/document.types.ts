import type { DocumentMeta } from '@/../../realtime/src/types/blocks';
import type * as Y from 'yjs';

export type {
  Document,
  DocumentMeta,
  Block,
  BlockType,
  ParagraphBlock,
  HeadingBlock,
  QuoteBlock,
  BulletListItemBlock,
  NumberedListItemBlock,
  CheckListItemBlock,
  ToggleListItemBlock,
  CodeBlock,
  FileBlock,
  ImageBlock,
  VideoBlock,
  AudioBlock,
  TableBlock,
  TableCell,
  TableContent,
  InlineContent,
  StyledText,
  Link,
  Styles,
  DefaultBlockProps,
  HeadingLevel,
  TextAlignment,
} from '@/../../realtime/src/types/blocks';

// Format we use when storing documents in IndexedDB
export interface StoredDocument {
  id: string;
  meta: DocumentMeta;
  yjsState: Uint8Array;
  version: number;
  /**
   * Provenance of the cached bytes. Documents mirrored from an anonymous
   * share-link view are tagged 'public-link' so private listings (sidebar,
   * panels, login promotion) can exclude someone else's shared content.
   * Absent on records written before this tag existed — treated as local.
   */
  origin?: 'local' | 'public-link';
}

// Format we use when passing loaded documents to components
export interface DocumentLoadResult {
  ydoc: Y.Doc;
  meta: DocumentMeta;
  origin?: StoredDocument['origin'];
}
