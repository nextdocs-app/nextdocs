import * as Y from 'yjs';
import { MAX_TEXT_BYTES } from './config.js';

/** Re-exported so callers and tests keep one import site for extraction limits. */
export { MAX_TEXT_BYTES };

export type ExtractedText = {
  text: string;
  truncated: boolean;
};

export type ExtractedTextResult = ExtractedText;

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

/** NUL and control characters except tab and newline: Postgres text cannot hold NUL. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Extracts the searchable text of a BlockNote document from its Yjs update.
 *
 * <p>This is a schema-aware XML walk, not BlockNote's own converter: that one needs an
 * editor and a ProseMirror schema, which are far heavier than a server-side text
 * projection needs. Unknown elements still contribute their children, so a custom block
 * cannot make text disappear; it just does not get its own line break.
 */
export function extractDocumentText(
  update: Uint8Array | null | undefined,
  maxBytes = MAX_TEXT_BYTES
): ExtractedText {
  const doc = new Y.Doc();
  try {
    // An empty or absent update is a legitimate empty document, not a failure.
    if (update && update.length > 0) {
      Y.applyUpdate(doc, update);
    }
    const parts: string[] = [];
    for (const child of doc.getXmlFragment('blocknote').toArray()) {
      walk(child, parts);
    }
    return capText(normalize(parts.join('')), maxBytes);
  } finally {
    doc.destroy();
  }
}

function walk(node: Y.XmlElement | Y.XmlText | Y.XmlHook, out: string[]): void {
  if (node instanceof Y.XmlText) {
    // toString() renders Yjs formatting as markup ("<bold><link href=\"…\">text</link></bold>")
    // and embeds as object strings. Only the string inserts are document text; attribute
    // names, formatting, and, importantly, link targets must never reach the index.
    for (const op of node.toDelta()) {
      if (typeof op.insert === 'string') {
        out.push(op.insert);
      }
    }
    return;
  }
  if (!(node instanceof Y.XmlElement)) {
    return;
  }

  const name = node.nodeName;

  if (name === 'tableRow') {
    node.toArray().forEach((cell, index) => {
      if (index > 0) {
        out.push(' | ');
      }
      if (cell instanceof Y.XmlElement) {
        for (const child of cell.toArray()) {
          walk(child, out);
        }
      }
    });
    out.push('\n');
    return;
  }

  // Cells are separated by the row, so they must not append a break of their own.
  if (name === 'tableCell') {
    for (const child of node.toArray()) {
      walk(child, out);
    }
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
    const label = firstAttribute(node, MENTION_LABEL_ATTRIBUTES);
    if (label) {
      out.push(label);
    }
    return;
  }

  if (CONTAINER_ELEMENTS.has(name)) {
    for (const child of node.toArray()) {
      walk(child, out);
    }
    return;
  }

  const isBlock = BLOCK_ELEMENTS.has(name);
  for (const child of node.toArray()) {
    walk(child, out);
  }
  // A space, not a newline, for an unknown or inline element: separating words matters,
  // but inventing a block boundary would reflow text that belongs to one line.
  out.push(isBlock ? '\n' : ' ');
}

function firstAttribute(node: Y.XmlElement, names: readonly string[]): string | null {
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value) {
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
