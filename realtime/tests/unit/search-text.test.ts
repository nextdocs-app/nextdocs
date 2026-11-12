import { describe, expect, it } from '@jest/globals';
import * as Y from 'yjs';
import { extractDocumentText, MAX_TEXT_BYTES } from '../../src/search-text.js';

function encode(build: (fragment: Y.XmlFragment) => void): Uint8Array {
  const doc = new Y.Doc();
  build(doc.getXmlFragment('blocknote'));
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function text(content: string): Y.XmlText {
  const node = new Y.XmlText();
  node.insert(0, content);
  return node;
}

function element(name: string, ...children: Array<Y.XmlElement | Y.XmlText>): Y.XmlElement {
  const node = new Y.XmlElement(name);
  node.insert(0, children);
  return node;
}

describe('extractDocumentText', () => {
  it('joins block text with newlines and keeps headings', () => {
    const update = encode((fragment) => {
      fragment.insert(0, [
        element('heading', text('Getting started')),
        element('paragraph', text('Install the app.')),
        element('paragraph', text('Then sign in.')),
      ]);
    });

    // One line per block: paragraphs are separated, not double-spaced.
    expect(extractDocumentText(update).text).toBe(
      'Getting started\nInstall the app.\nThen sign in.'
    );
  });

  it('renders table rows as pipe-separated cells', () => {
    const update = encode((fragment) => {
      fragment.insert(0, [
        element('tableRow', element('tableCell', text('Name')), element('tableCell', text('Role'))),
      ]);
    });

    expect(extractDocumentText(update).text).toBe('Name | Role');
  });

  it('keeps media captions and never indexes the attachment URL', () => {
    const image = element('image');
    image.setAttribute('url', '/api/v1/attachments/secret/file?sig=abc');
    image.setAttribute('caption', 'Architecture diagram');

    expect(extractDocumentText(encode((fragment) => fragment.insert(0, [image]))).text).toBe(
      'Architecture diagram'
    );
  });

  it('keeps text from an unknown custom block instead of dropping it', () => {
    const update = encode((fragment) => {
      fragment.insert(0, [element('customWidget', text('Quarterly numbers'))]);
    });

    expect(extractDocumentText(update).text).toBe('Quarterly numbers');
  });

  it('strips NUL and control characters and collapses tabs into spaces', () => {
    const update = encode((fragment) => {
      fragment.insert(0, [element('paragraph', text('a\u0000b\u0007c\td\ne'))]);
    });

    expect(extractDocumentText(update).text).toBe('abc d\ne');
  });

  it('drops deleted blocks from a later update', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('blocknote');
    const first = element('paragraph', text('keep me'));
    const second = element('paragraph', text('delete me'));
    fragment.insert(0, [first, second]);
    const beforeDelete = Y.encodeStateAsUpdate(doc);

    expect(extractDocumentText(beforeDelete).text).toContain('delete me');

    fragment.delete(1, 1);
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
    const update = encode((fragment) => {
      fragment.insert(0, [element('paragraph', text('Café 🚀 résumé'))]);
    });

    expect(extractDocumentText(update).text).toBe('Café 🚀 résumé');
  });

  it('caps the projection on a byte boundary and flags it', () => {
    const long = 'word '.repeat(MAX_TEXT_BYTES);
    const update = encode((fragment) => fragment.insert(0, [element('paragraph', text(long))]));
    const extracted = extractDocumentText(update, 1000);

    expect(extracted.truncated).toBe(true);
    expect(Buffer.byteLength(extracted.text, 'utf8')).toBeLessThanOrEqual(1000);
  });

  it('never leaves half of an emoji surrogate pair at the cut', () => {
    const update = encode((fragment) => {
      fragment.insert(0, [element('paragraph', text('🚀'.repeat(100)))]);
    });
    const extracted = extractDocumentText(update, 9);

    expect(extracted.truncated).toBe(true);
    expect(Buffer.byteLength(extracted.text, 'utf8')).toBeLessThanOrEqual(9);
    expect(extracted.text).not.toMatch(/[\ud800-\udbff]$/);
  });
});
