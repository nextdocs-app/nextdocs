import {
  DOCUMENT_META_UPDATED_EVENT,
  dispatchDocumentMetaUpdated,
  subscribeDocumentMetaUpdated,
} from '@/lib/document-meta-event.util';

describe('document-meta-event.util', () => {
  it('dispatches a window event with the document id and meta', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDocumentMetaUpdated(listener);
    const meta = {
      title: 'Live Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    dispatchDocumentMetaUpdated('doc-1', meta);

    expect(listener).toHaveBeenCalledWith({ id: 'doc-1', meta });
    unsubscribe();
  });

  it('exposes a stable event name shared by dispatch and subscribe', () => {
    expect(DOCUMENT_META_UPDATED_EVENT).toBe('document-meta-updated');
  });

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDocumentMetaUpdated(listener);
    unsubscribe();

    dispatchDocumentMetaUpdated('doc-1', {
      title: 'Ignored',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores events without a document id', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDocumentMetaUpdated(listener);

    window.dispatchEvent(
      new CustomEvent(DOCUMENT_META_UPDATED_EVENT, { detail: { id: '', meta: {} } })
    );

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
