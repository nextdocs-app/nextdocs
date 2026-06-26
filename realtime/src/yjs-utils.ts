import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';
import { WebSocket } from 'ws';

import logger from './logger.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_ACCESS_LEVEL = 2;

const SYNC_MESSAGE_STEP_2 = syncProtocol.messageYjsSyncStep2;
const SYNC_MESSAGE_UPDATE = syncProtocol.messageYjsUpdate;

const docs = new Map<string, WSSharedDoc>();

export type RealtimeAccessLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER';

// Levels that cannot write to document content
const DOCUMENT_WRITE_BLOCKED = new Set<RealtimeAccessLevel>(['VIEW', 'COMMENT']);
// Levels that cannot send awareness (cursor presence)
const NO_AWARENESS_LEVELS = new Set<RealtimeAccessLevel>(['VIEW']);

interface ConnectionState {
  clientIds: Set<number>;
  accessLevel: RealtimeAccessLevel;
}

function canWriteDocument(level: RealtimeAccessLevel): boolean {
  return !DOCUMENT_WRITE_BLOCKED.has(level);
}

function canSendAwareness(level: RealtimeAccessLevel): boolean {
  return !NO_AWARENESS_LEVELS.has(level);
}

class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<WebSocket, ConnectionState>;
  awareness: awarenessProtocol.Awareness;

  constructor(name: string) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);

    this.on('update', this._updateHandler.bind(this));
    this.awareness.on('update', this._awarenessUpdateHandler.bind(this));
  }

  _updateHandler(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    this.conns.forEach((_, conn) => {
      if (conn !== origin && conn.readyState === WebSocket.OPEN) {
        try {
          conn.send(message, { binary: true });
        } catch (err) {
          logger.error('Failed to send update', {
            error: (err as Error).message,
          });
        }
      }
    });
  }

  _awarenessUpdateHandler(
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void {
    if (origin instanceof WebSocket) {
      const originState = this.conns.get(origin);
      if (originState && !canSendAwareness(originState.accessLevel)) {
        logger.warn('Blocked awareness update from read-only connection', {
          docName: this.name,
          accessLevel: originState.accessLevel,
        });
        return;
      }
    }

    const changedClients = added.concat(updated).concat(removed);

    // Track which client IDs each connection controls
    if (origin instanceof WebSocket) {
      const state = this.conns.get(origin);
      if (state) {
        added.forEach((id) => state.clientIds.add(id));
        removed.forEach((id) => state.clientIds.delete(id));
      }
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
    );
    const message = encoding.toUint8Array(encoder);

    this.conns.forEach((_, conn) => {
      if (conn !== origin && conn.readyState === WebSocket.OPEN) {
        try {
          conn.send(message, { binary: true });
        } catch (err) {
          logger.error('Failed to send awareness update', {
            error: (err as Error).message,
          });
        }
      }
    });
  }

  destroy(): void {
    this.awareness.destroy();
    super.destroy();
  }
}

function getYDoc(docName: string): WSSharedDoc {
  return map.setIfUndefined(docs, docName, () => {
    const doc = new WSSharedDoc(docName);
    logger.debug('Created Yjs document', { docName });
    return doc;
  });
}

function shouldRejectSyncMessage(
  doc: WSSharedDoc,
  conn: WebSocket,
  syncMessageType: number,
  decoder?: decoding.Decoder
): boolean {
  const state = doc.conns.get(conn);
  if (!state) {
    return true;
  }

  // Only EDIT/OWNER can write document content
  if (!canWriteDocument(state.accessLevel)) {
    if (state.accessLevel === 'COMMENT') {
      if (syncMessageType === SYNC_MESSAGE_STEP_2 || syncMessageType === SYNC_MESSAGE_UPDATE) {
        if (!decoder) {
          return true;
        }

        try {
          const update = decoding.readVarUint8Array(decoder);
          const tempDoc = new Y.Doc();
          Y.applyUpdate(tempDoc, update);

          for (const key of tempDoc.share.keys()) {
            if (key !== 'threads' && key !== 'comment-users') {
              return true; // Block edits modifying anything else
            }
          }
          return false; // Allowed! Only modified threads or comment-users
        } catch (err) {
          logger.error('Failed to parse sync update for COMMENT connection', {
            error: (err as Error).message,
          });
          return true; // Reject if update is malformed/cannot be parsed
        }
      }

      // Any other sync messages (like sync step 1) are allowed since they don't perform writes
      return false;
    }

    // VIEW users cannot send any sync messages
    if (state.accessLevel === 'VIEW') {
      return true;
    }
  }

  return false;
}

function handleMessage(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array): void {
  try {
    const inspectionDecoder = decoding.createDecoder(message);
    const inspectionMessageType = decoding.readVarUint(inspectionDecoder);

    if (inspectionMessageType === MESSAGE_SYNC) {
      const syncMessageType = decoding.readVarUint(inspectionDecoder);
      if (shouldRejectSyncMessage(doc, conn, syncMessageType, inspectionDecoder)) {
        const state = doc.conns.get(conn);
        logger.warn('Blocked sync write message from read-only connection', {
          docName: doc.name,
          accessLevel: state?.accessLevel,
          syncMessageType,
        });
        return;
      }
    }

    if (inspectionMessageType === MESSAGE_AWARENESS) {
      const state = doc.conns.get(conn);
      if (!state || !canSendAwareness(state.accessLevel)) {
        logger.warn('Blocked awareness message from view-only connection', {
          docName: doc.name,
          accessLevel: state?.accessLevel,
        });
        return;
      }
    }

    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC:
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);

        if (encoding.length(encoder) > 1) {
          conn.send(encoding.toUint8Array(encoder), { binary: true });
        }
        break;

      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;

      default:
        logger.warn('Unknown message type', { messageType });
    }
  } catch (err) {
    logger.error('Error handling message', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}

export function setupWSConnection(
  conn: WebSocket,
  docName: string,
  accessLevel: RealtimeAccessLevel = 'EDIT'
): void {
  const doc = getYDoc(docName);

  doc.conns.set(conn, { clientIds: new Set(), accessLevel });

  // Send sync step 1 (full document state)
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  conn.send(encoding.toUint8Array(encoder), { binary: true });

  // Send current awareness states (cursors, presence)
  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
    );
    conn.send(encoding.toUint8Array(awarenessEncoder), { binary: true });
  }

  conn.on('message', (message) => {
    handleMessage(conn, doc, new Uint8Array(message as Buffer));
  });

  conn.on('close', () => {
    const controlledIds = doc.conns.get(conn)?.clientIds;
    doc.conns.delete(conn);

    if (controlledIds) {
      awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    }

    // Clean up document when last connection closes
    if (doc.conns.size === 0) {
      logger.debug('Destroying Yjs document (no connections)', { docName });
      doc.destroy();
      docs.delete(docName);
    }
  });
}

export function updateConnectionAccessLevel(
  conn: WebSocket,
  docName: string,
  accessLevel: RealtimeAccessLevel
): void {
  const doc = docs.get(docName);
  if (!doc) {
    return;
  }

  const state = doc.conns.get(conn);
  if (!state) {
    return;
  }

  const oldAccessLevel = state.accessLevel;
  state.accessLevel = accessLevel;

  // Notify client of access level change so they can update permissions immediately
  if (oldAccessLevel !== accessLevel && conn.readyState === WebSocket.OPEN) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_ACCESS_LEVEL);
    encoding.writeVarString(encoder, accessLevel);
    conn.send(encoding.toUint8Array(encoder), { binary: true });
    logger.info('Sent access level update to client', {
      docName,
      oldLevel: oldAccessLevel,
      newLevel: accessLevel,
    });
  }
}

export function getDocsStats(): Array<{ name: string; connections: number }> {
  return Array.from(docs.entries()).map(([name, doc]) => ({
    name,
    connections: doc.conns.size,
  }));
}

export { docs, MESSAGE_ACCESS_LEVEL };
