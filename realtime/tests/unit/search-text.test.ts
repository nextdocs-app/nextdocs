import { describe, expect, it } from '@jest/globals';
import * as Y from '@y/y';
import { extractDocumentText, MAX_TEXT_BYTES } from '../../src/search-text.js';

function encode(build: (root: Y.Node) => void): Uint8Array {
  const doc = new Y.Doc();
  build(doc.get('blocknote'));
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function element(name: string, content?: string | Y.Node[]): Y.Node {
  const node = new Y.Node(name);
  if (typeof content === 'string') {
    node.insert(0, content);
  } else if (content) {
    node.insert(0, content);
  }
  return node;
}

/**
 * The shape the editor writes (`pmnodeToDelta` on BlockNote's ProseMirror doc):
 * doc → blockGroup → blockContainer → paragraph, with the text runs owned by the
 * paragraph itself and inline atoms as sibling nodes.
 */
function block(name: string, content: string): Y.Node {
  return element(name, content);
}

function addBlock(root: Y.Node, blockNode: Y.Node): void {
  // The root has to own the node before its length can be read.
  root.insert(root.length, [blockNode]);
}

describe('extractDocumentText', () => {
  it('joins block text with newlines and keeps headings', () => {
    const update = encode((root) => {
      const group = element('blockGroup');
      addBlock(root, group);
      group.insert(0, [
        element('blockContainer', [block('heading', 'Getting started')]),
        element('blockContainer', [block('paragraph', 'Install the app.')]),
        element('blockContainer', [block('paragraph', 'Then sign in.')]),
      ]);
    });

    // One line per block: paragraphs are separated, not double-spaced.
    expect(extractDocumentText(update).text).toBe(
      'Getting started\nInstall the app.\nThen sign in.'
    );
  });

  it('keeps text from an unknown custom block instead of dropping it', () => {
    const update = encode((root) => {
      addBlock(root, element('customWidget', 'Quarterly numbers'));
    });

    expect(extractDocumentText(update).text).toBe('Quarterly numbers');
  });

  it('renders table rows as pipe-separated cells', () => {
    // BlockNote's table shape: table → tableRow → tableCell → tableParagraph.
    const update = encode((root) => {
      addBlock(
        root,
        element('tableRow', [
          element('tableCell', [element('tableParagraph', 'Name')]),
          element('tableCell', [element('tableParagraph', 'Role')]),
        ])
      );
    });

    expect(extractDocumentText(update).text).toBe('Name | Role');
  });

  it('keeps media captions and never indexes the attachment URL', () => {
    const image = element('image');
    image.setAttr('url', '/api/v1/attachments/secret/file?sig=abc');
    image.setAttr('caption', 'Architecture diagram');

    expect(extractDocumentText(encode((root) => addBlock(root, image))).text).toBe(
      'Architecture diagram'
    );
  });

  it('keeps a mention label without indexing its attributes', () => {
    const update = encode((root) => {
      const paragraph = element('paragraph');
      addBlock(root, paragraph);
      const mention = element('mention');
      mention.setAttr('name', 'Alice');
      mention.setAttr('id', 'user-1');
      paragraph.insert(0, 'ask ');
      paragraph.insert(4, [mention]);
    });

    expect(extractDocumentText(update).text).toBe('ask Alice');
  });

  it('indexes formatted text without mark attributes or link targets', () => {
    const update = encode((root) => {
      const paragraph = element('paragraph');
      addBlock(root, paragraph);
      paragraph.insert(0, 'See the runbook now');
      paragraph.format(8, 7, { link: { href: 'https://example.com/api/v1/attachments/secret' } });
      paragraph.format(16, 3, { bold: {} });
    });

    // Only character content is searchable: indexing mark attributes would leak
    // attribute names and signed URLs into the projection and its snippets.
    expect(extractDocumentText(update).text).toBe('See the runbook now');
  });

  it('strips NUL and control characters and collapses tabs into spaces', () => {
    const update = encode((root) => {
      addBlock(root, block('paragraph', 'a\u0000b\u0007c\td\ne'));
    });

    expect(extractDocumentText(update).text).toBe('abc d\ne');
  });

  it('drops deleted blocks from a later update', () => {
    const doc = new Y.Doc();
    const root = doc.get('blocknote');
    addBlock(root, block('paragraph', 'keep me'));
    addBlock(root, block('paragraph', 'delete me'));
    const beforeDelete = Y.encodeStateAsUpdate(doc);

    expect(extractDocumentText(beforeDelete).text).toContain('delete me');

    root.delete(1, 1);
    const afterDelete = Y.encodeStateAsUpdate(doc);
    expect(extractDocumentText(afterDelete).text).toBe('keep me');
    doc.destroy();
  });

  it('treats a never-written document as empty text', () => {
    expect(extractDocumentText(new Uint8Array(0))).toEqual({
      text: '',
      truncated: false,
    });
    expect(extractDocumentText(null)).toEqual({ text: '', truncated: false });
  });

  it('preserves unicode and emoji', () => {
    const update = encode((root) => addBlock(root, block('paragraph', 'Café 🚀 résumé')));

    expect(extractDocumentText(update).text).toBe('Café 🚀 résumé');
  });

  it('caps the projection on a byte boundary and flags it', () => {
    const long = 'word '.repeat(MAX_TEXT_BYTES);
    const update = encode((root) => addBlock(root, block('paragraph', long)));
    const extracted = extractDocumentText(update, 1000);

    expect(extracted.truncated).toBe(true);
    expect(Buffer.byteLength(extracted.text, 'utf8')).toBeLessThanOrEqual(1000);
  });

  it('never leaves half of an emoji surrogate pair at the cut', () => {
    const update = encode((root) => addBlock(root, block('paragraph', '🚀'.repeat(100))));
    const extracted = extractDocumentText(update, 9);

    expect(extracted.truncated).toBe(true);
    expect(Buffer.byteLength(extracted.text, 'utf8')).toBeLessThanOrEqual(9);
    expect(extracted.text).not.toMatch(/[\ud800-\udbff]$/);
  });
});
