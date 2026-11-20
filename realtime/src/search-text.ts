import * as Y from '@y/y';
import { MAX_TEXT_BYTES, UUID_REGEX } from './config.js';

/** Re-exported so callers and tests keep one import site for extraction limits. */
export { MAX_TEXT_BYTES };

export type ExtractedText = {
  text: string;
  truncated: boolean;
};

/** One mention found in the document. Only the stable id is needed downstream. */
export type MentionRef = {
  userId: string;
};

/** Text plus the mentions it contains, collected in one schema-aware walk. */
export type ExtractedDocument = ExtractedText & {
  mentions: MentionRef[];
};

export type ExtractedTextResult = ExtractedText;

/** A runaway document must not turn a compaction notification into a huge request. */
export const MAX_MENTIONS = 500;

/**
 * Structural wrappers around blocks. They add no separator of their own: the blocks
 * inside them already end a line, and a second break would double-space every page.
 */
const CONTAINER_ELEMENTS = new Set([
  'blockGroup',
  'blockContainer',
  'columnList',
  'column',
  'table',
]);

/**
 * BlockNote blocks that end a line. Their children still contribute inline text, which
 * is why the walk recurses first and only then appends the block break.
 */
const BLOCK_ELEMENTS = new Set([
  'paragraph',
  'heading',
  'quote',
  'codeBlock',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
]);

const MEDIA_ELEMENTS = new Set(['image', 'video', 'audio', 'file']);

/** Never include `url`/`href`: signed attachment paths are not searchable text. */
const MEDIA_LABEL_ATTRIBUTES = ['caption', 'name', 'alt', 'title'] as const;

const MENTION_ELEMENTS = new Set(['mention', 'reference']);

const MENTION_LABEL_ATTRIBUTES = ['name', 'label', 'title'] as const;

/** The stable user id prop; `name`/`label` are display snapshots only. */
const MENTION_USER_ID_ATTRIBUTES = ['userId', 'user'] as const;

/** NUL and control characters except tab and newline: Postgres text cannot hold NUL. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Extracts the searchable text of a BlockNote document from its Yjs update.
 *
 * <p>This is a schema-aware walk, not BlockNote's own converter: that one needs an
 * editor and a ProseMirror schema, which are far heavier than a server-side text
 * projection needs. Unknown elements still contribute their children, so a custom block
 * cannot make text disappear; it just does not get its own line break.
 *
 * <p>Yjs 14 stores a text run as a string child of its owning node, so the walk reads
 * `Y.Node` and string children: a paragraph owns its runs directly, and inline atoms
 * (mentions, images) are nodes among them. We migrated from Yjs 13 to Yjs 14 before the
 * release, so there is no legacy room shape or backfill to support.
 */
export function extractDocumentText(
  update: Uint8Array | null | undefined,
  maxBytes = MAX_TEXT_BYTES
): ExtractedText {
  const { text, truncated } = extractDocument(update, maxBytes);
  return { text, truncated };
}

/**
 * Extracts the text projection and the user mentions in one walk. Search text and the
 * mention index are both derived from the same Y.Doc, so doing them separately would
 * walk (and allocate) the whole document twice on every compaction.
 */
export function extractDocument(
  update: Uint8Array | null | undefined,
  maxBytes = MAX_TEXT_BYTES
): ExtractedDocument {
  const doc = new Y.Doc();
  try {
    // An empty or absent update is a legitimate empty document, not a failure.
    if (update && update.length > 0) {
      Y.applyUpdate(doc, update);
    }
    const parts: string[] = [];
    const mentions = new Map<string, MentionRef>();
    for (const child of doc.get('blocknote').toArray()) {
      if (typeof child === 'string') {
        parts.push(child);
      } else if (child instanceof Y.Node) {
        walk(child, parts, mentions);
      }
    }
    return {
      ...capText(normalize(parts.join('')), maxBytes),
      mentions: Array.from(mentions.values()),
    };
  } finally {
    doc.destroy();
  }
}

function walk(node: Y.Node, out: string[], mentions: Map<string, MentionRef>): void {
  const name = node.name ?? '';

  if (name === 'tableRow') {
    let firstCell = true;
    for (const cell of node.toArray()) {
      if (typeof cell === 'string') {
        out.push(cell);
        continue;
      }
      if (!(cell instanceof Y.Node)) {
        continue;
      }
      if (!firstCell) {
        out.push(' | ');
      }
      firstCell = false;
      visitChildren(cell, out, mentions);
    }
    out.push('\n');
    return;
  }

  // Cells are separated by the row, so they must not append a break of their own.
  if (name === 'tableCell') {
    visitChildren(node, out, mentions);
    return;
  }

  if (MEDIA_ELEMENTS.has(name)) {
    const label = firstAttribute(node, MEDIA_LABEL_ATTRIBUTES);
    if (label) {
      out.push(label);
    }
    out.push('\n');
    return;
  }

  if (MENTION_ELEMENTS.has(name)) {
    const userId = firstAttribute(node, MENTION_USER_ID_ATTRIBUTES);
    if (
      userId &&
      UUID_REGEX.test(userId) &&
      !mentions.has(userId) &&
      mentions.size < MAX_MENTIONS
    ) {
      mentions.set(userId, { userId });
    }
    const label = firstAttribute(node, MENTION_LABEL_ATTRIBUTES);
    if (label) {
      out.push(label);
    }
    return;
  }

  visitChildren(node, out, mentions);

  if (CONTAINER_ELEMENTS.has(name)) {
    return;
  }
  // A space, not a newline, for an unknown or inline element: separating words matters,
  // but inventing a block boundary would reflow text that belongs to one line.
  out.push(BLOCK_ELEMENTS.has(name) ? '\n' : ' ');
}

/** Recurses in document order, appending the text runs of string children as-is. */
function visitChildren(node: Y.Node, out: string[], mentions: Map<string, MentionRef>): void {
  for (const child of node.toArray()) {
    if (typeof child === 'string') {
      // Formats (bold, link, …) never reach the projection: only the character
      // content is indexed, so a signed link target cannot leak into a snippet.
      out.push(child);
    } else if (child instanceof Y.Node) {
      walk(child, out, mentions);
    }
  }
}

function firstAttribute(node: Y.Node, names: readonly string[]): string | null {
  for (const name of names) {
    const value = node.getAttr(name);
    if (typeof value === 'string' && value) {
      return value;
    }
  }
  return null;
}

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Clips at a UTF-8 byte boundary. Cutting on a newline keeps the last fragment readable;
 * a lone high surrogate at the cut is dropped so the text stays valid Unicode.
 */
function capText(text: string, maxBytes: number): ExtractedText {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  let end = low;
  const lastNewline = text.lastIndexOf('\n', end);
  if (lastNewline > end / 2) {
    end = lastNewline;
  }
  // slice() works on UTF-16 units; never leave half of a surrogate pair behind.
  if (end > 0 && /[\ud800-\udbff]/.test(text.charAt(end - 1))) {
    end--;
  }

  const clipped = text.slice(0, end).trimEnd();
  return { text: clipped, truncated: true };
}
