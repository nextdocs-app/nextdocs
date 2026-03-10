import * as Y from 'yjs';
import {
  createYjsDoc,
  encodeYjsState,
  decodeYjsState,
  createDefaultDocumentMeta,
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
      const fragment = ydoc.getXmlFragment('test');
      const element = new Y.XmlElement('paragraph');
      fragment.push([element]);

      const encoded = encodeYjsState(ydoc);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('decodeYjsState', () => {
    it('should decode Uint8Array to Y.Doc', () => {
      const originalDoc = new Y.Doc();
      const fragment = originalDoc.getXmlFragment('test');
      const element = new Y.XmlElement('paragraph');
      element.setAttribute('id', 'test-id');
      fragment.push([element]);

      const encoded = encodeYjsState(originalDoc);
      const decodedDoc = decodeYjsState(encoded);

      expect(decodedDoc).toBeInstanceOf(Y.Doc);
      const decodedFragment = decodedDoc.getXmlFragment('test');
      expect(decodedFragment.length).toBe(1);
    });

    it('should preserve Yjs document structure', () => {
      const originalDoc = new Y.Doc();
      const state = Y.encodeStateAsUpdate(originalDoc);

      const decodedDoc = decodeYjsState(state);
      const decodedState = Y.encodeStateAsUpdate(decodedDoc);

      expect(decodedState).toEqual(state);
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
