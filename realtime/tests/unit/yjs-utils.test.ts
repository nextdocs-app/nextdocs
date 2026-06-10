import { jest } from '@jest/globals';
import * as syncing from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import logger from '../../src/logger';

// Mock logger to avoid console output during tests
jest.mock('../../src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  setupWSConnection,
  updateConnectionAccessLevel,
  docs,
  getDocsStats,
} from '../../src/yjs-utils';

describe('Yjs Utils', () => {
  let mockConn: any;
  const docName = 'test-doc';

  beforeEach(() => {
    docs.clear();

    mockConn = {
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
    };
  });

  afterEach(() => {
    docs.forEach((doc) => doc.destroy());
    docs.clear();
    jest.clearAllMocks();
  });

  describe('setupWSConnection', () => {
    it('should create a new document if it does not exist', () => {
      setupWSConnection(mockConn, docName);
      expect(docs.has(docName)).toBe(true);
      expect(getDocsStats()).toEqual([{ name: docName, connections: 1 }]);
    });

    it('should reuse existing document', () => {
      setupWSConnection(mockConn, docName);
      const doc = docs.get(docName);

      const mockConn2: any = {
        send: jest.fn(),
        on: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      setupWSConnection(mockConn2, docName);
      expect(docs.get(docName)).toBe(doc);
      expect(docs.get(docName)?.conns.size).toBe(2);
    });

    it('should send sync step 1 and awareness on connection', () => {
      setupWSConnection(mockConn, docName);

      expect(mockConn.send).toHaveBeenCalled();

      // Verify first message is sync step 1
      const calls = mockConn.send.mock.calls;
      let hasSyncStep1 = false;

      for (const [arg] of calls) {
        const decoder = decoding.createDecoder(arg);
        const messageType = decoding.readVarUint(decoder);
        if (messageType === 0) {
          // MESSAGE_SYNC
          const syncMessageType = decoding.readVarUint(decoder);
          if (syncMessageType === syncing.messageYjsSyncStep1) {
            hasSyncStep1 = true;
          }
        }
      }

      // Note: Awareness might not be sent if empty, but sync step 1 is always sent
      expect(hasSyncStep1).toBe(true);
    });

    it('should handle incoming updates', () => {
      setupWSConnection(mockConn, docName);

      // Simulate client sending an update
      const messageHandlerCall = mockConn.on.mock.calls.find((call: any) => call[0] === 'message');
      if (!messageHandlerCall) {
        throw new Error('message handler not found');
      }
      const messageHandler = messageHandlerCall[1];

      const doc = docs.get(docName);
      if (!doc) {
        throw new Error(`Document ${docName} not found`);
      }

      // Reset mock history to isolate the subsequent send call
      mockConn.send.mockClear();

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
      syncing.writeSyncStep1(encoder, doc);
      const message = encoding.toUint8Array(encoder);

      messageHandler(Buffer.from(message));

      expect(mockConn.send).toHaveBeenCalled();
    });

    it('should clean up on close', () => {
      setupWSConnection(mockConn, docName);

      const closeHandlerCall = mockConn.on.mock.calls.find((call: any) => call[0] === 'close');
      if (!closeHandlerCall) {
        throw new Error('close handler not found');
      }
      const closeHandler = closeHandlerCall[1];
      closeHandler();

      expect(docs.has(docName)).toBe(false);
    });

    it('should not destroy document if other connections exist', () => {
      setupWSConnection(mockConn, docName);

      const mockConn2: any = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN,
      };
      setupWSConnection(mockConn2, docName);

      const closeHandlerCall = mockConn.on.mock.calls.find((call: any) => call[0] === 'close');
      if (!closeHandlerCall) {
        throw new Error('close handler not found');
      }
      const closeHandler = closeHandlerCall[1];
      closeHandler();

      expect(docs.has(docName)).toBe(true);
      expect(docs.get(docName)?.conns.size).toBe(1);
    });

    it('should block sync update writes for read-only connections', () => {
      const readOnlyConn: any = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      const writableConn: any = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      setupWSConnection(readOnlyConn, docName, 'VIEW');
      setupWSConnection(writableConn, docName, 'EDIT');

      readOnlyConn.send.mockClear();
      writableConn.send.mockClear();

      const readOnlyMessageHandlerCall = readOnlyConn.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      );
      if (!readOnlyMessageHandlerCall) {
        throw new Error('message handler not found for read-only connection');
      }

      const readOnlyMessageHandler = readOnlyMessageHandlerCall[1];
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('t').insert(0, 'hello');
      const update = Y.encodeStateAsUpdate(sourceDoc);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
      syncing.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      readOnlyMessageHandler(Buffer.from(message));

      expect(writableConn.send).not.toHaveBeenCalled();
    });

    it('should block sync update writes for comment connections', () => {
      const commentConn: any = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      const writableConn: any = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      setupWSConnection(commentConn, docName, 'COMMENT');
      setupWSConnection(writableConn, docName, 'EDIT');

      commentConn.send.mockClear();
      writableConn.send.mockClear();

      const commentMessageHandlerCall = commentConn.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      );
      if (!commentMessageHandlerCall) {
        throw new Error('message handler not found for comment connection');
      }

      const commentMessageHandler = commentMessageHandlerCall[1];
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('t').insert(0, 'hello');
      const update = Y.encodeStateAsUpdate(sourceDoc);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
      syncing.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      commentMessageHandler(Buffer.from(message));

      expect(writableConn.send).not.toHaveBeenCalled();

      const blockedWarnings = (logger.warn as jest.Mock).mock.calls.filter(
        ([warningMessage]) =>
          warningMessage === 'Blocked sync write message from read-only connection'
      );
      expect(blockedWarnings.length).toBeGreaterThan(0);
    });

    it('should allow sync step 2 for comment connections', () => {
      const commentConn: any = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      setupWSConnection(commentConn, docName, 'COMMENT');
      commentConn.send.mockClear();

      const commentMessageHandlerCall = commentConn.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      );
      if (!commentMessageHandlerCall) {
        throw new Error('message handler not found for comment connection');
      }

      const commentMessageHandler = commentMessageHandlerCall[1];
      const doc = docs.get(docName);
      if (!doc) {
        throw new Error(`Document ${docName} not found`);
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
      syncing.writeSyncStep2(encoder, doc);
      const message = encoding.toUint8Array(encoder);

      commentMessageHandler(Buffer.from(message));

      const blockedWarnings = (logger.warn as jest.Mock).mock.calls.filter(
        ([warningMessage]) =>
          warningMessage === 'Blocked sync write message from read-only connection'
      );
      expect(blockedWarnings).toHaveLength(0);
    });

    it('should allow write updates after permission upgrade', () => {
      const upgradedConn: any = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      setupWSConnection(upgradedConn, docName, 'VIEW');
      setupWSConnection(mockConn, docName, 'EDIT');
      updateConnectionAccessLevel(upgradedConn, docName, 'EDIT');

      const messageHandlerCall = upgradedConn.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      );
      if (!messageHandlerCall) {
        throw new Error('message handler not found');
      }
      const messageHandler = messageHandlerCall[1];

      mockConn.send.mockClear();
      upgradedConn.send.mockClear();

      const doc = docs.get(docName);
      if (!doc) {
        throw new Error(`Document ${docName} not found`);
      }

      const sourceDoc = new Y.Doc();
      sourceDoc.getText('t').insert(0, 'hello');
      const update = Y.encodeStateAsUpdate(sourceDoc, Y.encodeStateVector(doc));

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
      syncing.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      messageHandler(Buffer.from(message));

      expect(mockConn.send).toHaveBeenCalled();
    });
  });

  describe('getDocsStats', () => {
    it('should return correct stats', () => {
      setupWSConnection(mockConn, 'doc1');

      const mockConn2: any = {
        send: jest.fn(),
        on: jest.fn(),
        readyState: WebSocket.OPEN,
      };
      setupWSConnection(mockConn2, 'doc2');

      const stats = getDocsStats();
      expect(stats).toHaveLength(2);
      expect(stats).toContainEqual({ name: 'doc1', connections: 1 });
      expect(stats).toContainEqual({ name: 'doc2', connections: 1 });
    });
  });
});
