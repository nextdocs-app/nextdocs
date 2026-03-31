import * as Y from 'yjs';
import { getDocsEligibleForAccountMove } from '../../../components/AppShell';
import type { StoredDocument } from '../../../types/document.types';

function createStoredDocument(id: string, title: string, hasContent: boolean): StoredDocument {
  const ydoc = new Y.Doc();

  if (hasContent) {
    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);
  }

  const yjsState = Y.encodeStateAsUpdate(ydoc);

  return {
    id,
    meta: {
      title,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    yjsState,
    version: 1,
  };
}

describe('getDocsEligibleForAccountMove', () => {
  it('filters out empty untitled placeholders', () => {
    const docs = [
      createStoredDocument('empty-untitled', 'Untitled', false),
      createStoredDocument('untitled-with-content', 'Untitled', true),
      createStoredDocument('named-empty', 'Project notes', false),
    ];

    const eligible = getDocsEligibleForAccountMove(docs);

    expect(eligible.map((doc) => doc.id)).toEqual(['untitled-with-content', 'named-empty']);
  });

  it('treats blank titles as untitled for filtering', () => {
    const docs = [
      createStoredDocument('blank-title-empty', '   ', false),
      createStoredDocument('blank-title-content', '   ', true),
    ];

    const eligible = getDocsEligibleForAccountMove(docs);

    expect(eligible.map((doc) => doc.id)).toEqual(['blank-title-content']);
  });
});
