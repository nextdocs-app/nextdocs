import * as Y from '@y/y';
import {
  createYjsDoc,
  encodeYjsState,
  decodeYjsState,
  createDefaultDocumentMeta,
  getYjsStringMap,
} from '@/lib/yjs.util';

describe('yjs.util', () => {
  describe('createYjsDoc', () => {
    it('should create a new Y.Doc instance', () => {
      const ydoc = createYjsDoc();
      expect(ydoc).toBeInstanceOf(Y.Doc);
    });

    it('should create an empty document', () => {
      const ydoc = createYjsDoc();
      const state = Y.encodeStateAsUpdate(ydoc);
      expect(state.length).toBeGreaterThan(0);
    });
  });

  describe('encodeYjsState', () => {
    it('should encode Y.Doc to Uint8Array', () => {
      const ydoc = new Y.Doc();
      getYjsStringMap(ydoc, 'test').set('paragraph', '1');

      const encoded = encodeYjsState(ydoc);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('decodeYjsState', () => {
    it('should decode Uint8Array to Y.Doc', () => {
      const originalDoc = new Y.Doc();
      getYjsStringMap(originalDoc, 'test').set('id', 'test-id');

      const encoded = encodeYjsState(originalDoc);
      const decodedDoc = decodeYjsState(encoded);

      expect(decodedDoc).toBeInstanceOf(Y.Doc);
      expect(getYjsStringMap(decodedDoc, 'test').get('id')).toBe('test-id');
    });

    it('should preserve Yjs document content', () => {
      const originalDoc = new Y.Doc();
      originalDoc.get('blocknote').insert(0, ['hello']);

      const decodedDoc = decodeYjsState(encodeYjsState(originalDoc));

      expect(decodedDoc.get('blocknote').length).toBe(1);
      expect(JSON.stringify(decodedDoc.get('blocknote').toDelta())).toContain('hello');
    });
  });

  describe('getYjsStringMap', () => {
    it('exposes string values and filters anything else', () => {
      const ydoc = new Y.Doc();
      const map = getYjsStringMap(ydoc, 'meta');
      map.set('title', 'Hello');

      expect(map.get('title')).toBe('Hello');
      expect(map.has('title')).toBe(true);
      expect(map.get('missing')).toBeUndefined();

      // A hand-crafted writer can put a non-string under a key. The facade is
      // the typed boundary, so consumers must never see it.
      (ydoc.get('meta') as unknown as { setAttr(name: string, value: unknown): void }).setAttr(
        'bad',
        42
      );
      expect(map.get('bad')).toBeUndefined();
    });

    it('emits nothing when deleting a key that was never set', () => {
      const ydoc = new Y.Doc();
      const map = getYjsStringMap(ydoc, 'meta');
      const listener = jest.fn();
      map.observe(listener);

      map.delete('missing');

      expect(listener).not.toHaveBeenCalled();
    });

    it('distinguishes a set from a delete through keysChanged', () => {
      const ydoc = new Y.Doc();
      const map = getYjsStringMap(ydoc, 'meta');
      const deletions: string[][] = [];
      map.observe((change) => deletions.push([...change.deleted]));

      map.set('title', 'A');
      expect(deletions).toEqual([[]]);

      map.delete('title');
      expect(deletions).toEqual([[], ['title']]);
      expect(map.has('title')).toBe(false);
    });

    it('stops delivering once the observer is unsubscribed', () => {
      const ydoc = new Y.Doc();
      const map = getYjsStringMap(ydoc, 'meta');
      const listener = jest.fn();
      const unsubscribe = map.observe(listener);

      map.set('title', 'A');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      map.set('title', 'B');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('createDefaultDocumentMeta', () => {
    it('should create metadata with default title', () => {
      const meta = createDefaultDocumentMeta();

      expect(meta).toMatchObject({
        title: 'Untitled',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('should create metadata with custom title', () => {
      const meta = createDefaultDocumentMeta('My Document');

      expect(meta.title).toBe('My Document');
    });

    it('should create metadata with ISO timestamp format', () => {
      const meta = createDefaultDocumentMeta();

      expect(meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(meta.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should create metadata with same createdAt and updatedAt', () => {
      const meta = createDefaultDocumentMeta();
      expect(meta.createdAt).toBe(meta.updatedAt);
    });
  });
});
