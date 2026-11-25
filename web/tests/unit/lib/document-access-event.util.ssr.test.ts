/**
 * @jest-environment node
 */
import {
  dispatchDocumentAccessChanged,
  subscribeDocumentAccessChanged,
} from '@/lib/document-access-event.util';

describe('document-access-event.util without a window', () => {
  it('does not touch window during server rendering', () => {
    expect(typeof window).toBe('undefined');
    expect(() => dispatchDocumentAccessChanged('doc-1')).not.toThrow();
    expect(subscribeDocumentAccessChanged(jest.fn())()).toBeUndefined();
  });
});
