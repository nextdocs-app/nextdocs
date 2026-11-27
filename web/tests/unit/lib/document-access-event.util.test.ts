import {
  DOCUMENT_ACCESS_CHANGED_EVENT,
  dispatchDocumentAccessChanged,
  subscribeDocumentAccessChanged,
} from '@/lib/document-access-event.util';

describe('document-access-event.util', () => {
  it('dispatches the document id and ignores events without one', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDocumentAccessChanged(listener);

    dispatchDocumentAccessChanged('doc-1');
    window.dispatchEvent(new CustomEvent(DOCUMENT_ACCESS_CHANGED_EVENT));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('doc-1');

    unsubscribe();
    dispatchDocumentAccessChanged('doc-2');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
