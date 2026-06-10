import { jest } from '@jest/globals';
import request from 'supertest';
import { EventEmitter } from 'events';

jest.mock('ws', () => {
  const { EventEmitter } = require('events');
  class MockWebSocketServer extends EventEmitter {
    clients = { size: 0 };
    close = jest.fn();
    constructor() {
      super();
    }
  }
  return {
    WebSocketServer: MockWebSocketServer,
    WebSocket: { OPEN: 1 },
  };
});

jest.mock('../../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/yjs-utils', () => ({
  __esModule: true,
  setupWSConnection: jest.fn(),
  updateConnectionAccessLevel: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    port: 1234,
    host: '0.0.0.0',
    apiBaseUrl: 'http://localhost:8080',
    corsOrigins: ['*'],
    logLevel: 'info',
    roomCleanupInterval: 300000,
    roomInactiveTimeout: 3600000,
    accessRevalidationIntervalMs: 5000,
    fetchTimeoutMs: 5000,
    unauthorizedAccessCooldownMs: 15000,
    unauthorizedAccessWarnIntervalMs: 10000,
    enforceMemoryThreshold: false,
    limits: {
      maxPayload: 5 * 1024 * 1024,
      maxConnsPerIp: 200,
      maxGlobalConns: 10000,
      maxConnRatePerMin: 100,
      maxMsgRatePerSec: 100,
      memoryThreshold: 0.95,
    },
  },
}));

import { WebSocket } from 'ws';

const VALID_ROOM_ID = '11111111-1111-1111-1111-111111111111';

const waitForConnectionProcessing = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Server', () => {
  let server: any;
  let wss: any;
  let cleanupInactiveRooms: any;
  let setupWSConnectionMock: any;
  let memoryUsageSpy: any;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(async () => {
    jest.resetModules();

    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          allowed: true,
          accessLevel: 'EDIT',
          owner: false,
        },
        error: null,
      }),
    } as Response);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    memoryUsageSpy = jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100,
      heapTotal: 100,
      heapUsed: 10,
      external: 0,
      arrayBuffers: 0,
    } as NodeJS.MemoryUsage);

    const serverModule = await import('../../src/server');
    server = serverModule.server;
    wss = serverModule.wss;
    cleanupInactiveRooms = serverModule.cleanupInactiveRooms;

    const yjsUtilsModule = await import('../../src/yjs-utils');
    setupWSConnectionMock = yjsUtilsModule.setupWSConnection;
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (memoryUsageSpy) memoryUsageSpy.mockRestore();
    if (server && server.listening) {
      server.close();
    }
  });

  describe('HTTP Endpoints', () => {
    it('GET /health should return 200 OK', async () => {
      const response = await request(server).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
    });

    it('GET /metrics should return 200 OK', async () => {
      const response = await request(server).get('/metrics');
      expect(response.status).toBe(200);
    });

    it('OPTIONS should handle CORS', async () => {
      const response = await request(server)
        .options('/any-route')
        .set('Origin', 'http://localhost:3000');
      expect(response.status).toBe(204);
    });
  });

  describe('WebSocket Connection', () => {
    let mockReq: any;
    let mockConn: any;

    beforeEach(() => {
      mockReq = {
        url: `/${VALID_ROOM_ID}?token=test-token`,
        headers: { host: 'localhost:1234' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      mockConn = new EventEmitter();
      (mockConn as any).close = jest.fn();
      (mockConn as any).readyState = WebSocket.OPEN;
      wss.clients.size = 0;
    });

    it('should accept connection with valid room ID', async () => {
      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();
      expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');
      expect(mockConn.close).not.toHaveBeenCalled();
    });

    it('should reject connection when access-check denies access', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            allowed: false,
            accessLevel: null,
            owner: false,
          },
          error: null,
        }),
      } as Response);

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(mockConn.close).toHaveBeenCalledWith(1008, 'Access denied');
      expect(setupWSConnectionMock).not.toHaveBeenCalled();
    });

    it('should reject connection with missing room ID', async () => {
      mockReq.url = '/';
      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();
      expect(mockConn.close).toHaveBeenCalledWith(
        1008,
        expect.stringContaining('Room ID required')
      );
    });

    it('should reject connection with invalid room ID format before access-check', async () => {
      mockReq.url = '/default-doc?token=test-token';

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(mockConn.close).toHaveBeenCalledWith(1008, 'Invalid room ID');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(setupWSConnectionMock).not.toHaveBeenCalled();
    });

    it('should suppress repeated unauthorized access checks during cooldown', async () => {
      jest.useFakeTimers();

      try {
        fetchMock
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                allowed: false,
                accessLevel: null,
                owner: false,
              },
              error: null,
            }),
          } as Response)
          .mockResolvedValue({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                allowed: true,
                accessLevel: 'EDIT',
                owner: false,
              },
              error: null,
            }),
          } as Response);

        const firstConn: any = new EventEmitter();
        firstConn.close = jest.fn();
        firstConn.readyState = WebSocket.OPEN;
        wss.emit('connection', firstConn, mockReq);
        await waitForConnectionProcessing();

        expect(firstConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const secondConn: any = new EventEmitter();
        secondConn.close = jest.fn();
        secondConn.readyState = WebSocket.OPEN;
        wss.emit('connection', secondConn, mockReq);
        await waitForConnectionProcessing();

        expect(secondConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(15001);

        const thirdConn: any = new EventEmitter();
        thirdConn.close = jest.fn();
        thirdConn.readyState = WebSocket.OPEN;
        wss.emit('connection', thirdConn, mockReq);
        await waitForConnectionProcessing();

        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not clear renewed cooldown state when stale expirations are cleaned', async () => {
      jest.useFakeTimers();

      try {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              allowed: false,
              accessLevel: null,
              owner: false,
            },
            error: null,
          }),
        } as Response);

        const firstConn: any = new EventEmitter();
        firstConn.close = jest.fn();
        firstConn.readyState = WebSocket.OPEN;
        wss.emit('connection', firstConn, mockReq);
        await waitForConnectionProcessing();

        expect(firstConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(15001);

        const secondConn: any = new EventEmitter();
        secondConn.close = jest.fn();
        secondConn.readyState = WebSocket.OPEN;
        wss.emit('connection', secondConn, mockReq);
        await waitForConnectionProcessing();

        expect(secondConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        cleanupInactiveRooms();

        const thirdConn: any = new EventEmitter();
        thirdConn.close = jest.fn();
        thirdConn.readyState = WebSocket.OPEN;
        wss.emit('connection', thirdConn, mockReq);
        await waitForConnectionProcessing();

        // Third attempt is still blocked by the renewed cooldown, so no new access check runs.
        expect(thirdConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should handle synchronous error in setupWSConnection', async () => {
      // Mock setupWSConnection to throw synchronously
      setupWSConnectionMock.mockImplementationOnce(() => {
        throw new Error('Sync setup error');
      });

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');
      // valid connection rejected due to internal error
      expect(mockConn.close).toHaveBeenCalledWith(1011, 'Internal server error');

      const response = await request(server).get('/metrics');
      const metrics = JSON.parse(response.text);
      const room = metrics.rooms.find((r: any) => r.id === VALID_ROOM_ID);

      // Should be 0 connections
      if (room) {
        expect(room.connections).toBe(0);
      } else {
        // Or completely cleaned up
        expect(true).toBe(true);
      }
    });
  });

  describe('DoS Mitigations', () => {
    let mockReq: any;
    let mockConn: any;

    beforeEach(() => {
      mockReq = {
        url: `/${VALID_ROOM_ID}?token=test-token`,
        headers: { host: 'localhost:1234' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      mockConn = new EventEmitter();
      (mockConn as any).close = jest.fn();
      (mockConn as any).readyState = WebSocket.OPEN;

      wss.clients.size = 0;
    });

    it('should reject when global connection limit is reached', async () => {
      wss.clients.size = 10001;
      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();
      expect(mockConn.close).toHaveBeenCalledWith(1008, 'Server busy');
    });

    it('should reject when IP connection limit is reached', async () => {
      jest.useFakeTimers();
      try {
        const ip = '10.0.0.1';
        mockReq.socket.remoteAddress = ip;

        // Max IP limit 200. Rate limit 100.
        // Create 100 connections
        for (let i = 0; i < 100; i++) {
          const conn: any = new EventEmitter();
          conn.close = jest.fn();
          wss.emit('connection', conn, mockReq);
          await waitForConnectionProcessing();
        }

        // Advance time by 1 minute to clear rate limit window
        jest.advanceTimersByTime(60001);

        // Create another 100 connections
        for (let i = 0; i < 100; i++) {
          const conn: any = new EventEmitter();
          conn.close = jest.fn();
          wss.emit('connection', conn, mockReq);
          await waitForConnectionProcessing();
        }

        // 201st connection (should hit IP limit, not rate limit)
        const rejectedConn: any = new EventEmitter();
        rejectedConn.close = jest.fn();
        wss.emit('connection', rejectedConn, mockReq);
        await waitForConnectionProcessing();

        expect(rejectedConn.close).toHaveBeenCalledTimes(1);
        expect(rejectedConn.close).toHaveBeenCalledWith(1008, 'Too many connections');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should reject when IP connection rate limit is exceeded', async () => {
      const ip = '10.0.0.2';
      mockReq.socket.remoteAddress = ip;

      // Rate limit is 100/min. IP limit is 200.
      // So we can hit 100 connections without hitting IP limit.

      for (let i = 0; i < 100; i++) {
        const conn: any = new EventEmitter();
        conn.close = jest.fn();
        wss.emit('connection', conn, mockReq);
      }

      // 101st connection within same minute -> Rate exceeded
      const rejectedConn: any = new EventEmitter();
      rejectedConn.close = jest.fn();
      wss.emit('connection', rejectedConn, mockReq);
      await waitForConnectionProcessing();

      expect(rejectedConn.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
    });

    it('should enforce message rate limits', async () => {
      const ip = '10.0.0.3';
      mockReq.socket.remoteAddress = ip;
      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      // Since wss is a mock event emitter, wss.emit call runs synchronously.
      // The 'connection' handler in server.ts calls conn.on('message', ...).
      // So mockConn.on IS called synchronously.

      // Send 100 messages
      for (let i = 0; i < 100; i++) {
        mockConn.emit('message', Buffer.from('test'), false);
      }
      expect(mockConn.close).not.toHaveBeenCalled();

      // 101st
      mockConn.emit('message', Buffer.from('test'), false);
      expect(mockConn.close).toHaveBeenCalledWith(1008, 'Message rate limit exceeded');
    });

    it('should enforce payload size limits', async () => {
      const ip = '10.0.0.4';
      mockReq.socket.remoteAddress = ip;
      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);
      mockConn.emit('message', largeBuffer, false);

      expect(mockConn.close).toHaveBeenCalledWith(1009, 'Payload too large');
    });
  });
  describe('Client IP Detection', () => {
    let mockReq: any;
    let mockConn: any;

    beforeEach(() => {
      mockReq = {
        url: `/${VALID_ROOM_ID}?token=test-token`,
        headers: { host: 'localhost:1234' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      mockConn = new EventEmitter();
      (mockConn as any).close = jest.fn();
      (mockConn as any).readyState = WebSocket.OPEN;
      wss.clients.size = 0;
    });

    it('should use X-Forwarded-For header if present', async () => {
      // Test that rate limits are applied per-IP extracted from header

      const ip1 = '10.0.0.5';
      const ip2 = '10.0.0.6';

      // Exhaust rate limit for ip1 (limit is 100)
      mockReq.headers['x-forwarded-for'] = ip1;
      for (let i = 0; i < 100; i++) {
        const conn: any = new EventEmitter();
        conn.close = jest.fn();
        wss.emit('connection', conn, mockReq);
      }

      // Next connection from ip1 should fail due to rate limit
      const rejectedConn: any = new EventEmitter();
      rejectedConn.close = jest.fn();
      wss.emit('connection', rejectedConn, mockReq);
      await waitForConnectionProcessing();
      expect(rejectedConn.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');

      // Connection from ip2 should succeed (different IP)
      const allowedConn: any = new EventEmitter();
      allowedConn.close = jest.fn();
      mockReq.headers['x-forwarded-for'] = ip2;
      wss.emit('connection', allowedConn, mockReq);
      await waitForConnectionProcessing();
      expect(allowedConn.close).not.toHaveBeenCalled();
    });

    it('should use first IP in comma-separated X-Forwarded-For header', async () => {
      const realIp1 = '10.0.0.7';
      const realIp2 = '10.0.0.8';
      const proxyIp = '192.168.1.1';

      // Exhaust rate limit for realIp1
      mockReq.headers['x-forwarded-for'] = `${realIp1}, ${proxyIp}`;
      for (let i = 0; i < 100; i++) {
        const conn: any = new EventEmitter();
        conn.close = jest.fn();
        wss.emit('connection', conn, mockReq);
      }

      // Next connection should fail
      const rejectedConn: any = new EventEmitter();
      rejectedConn.close = jest.fn();
      wss.emit('connection', rejectedConn, mockReq);
      await waitForConnectionProcessing();
      expect(rejectedConn.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');

      // Connection from realIp2 should succeed even with same proxy IP suffix
      const allowedConn: any = new EventEmitter();
      allowedConn.close = jest.fn();
      mockReq.headers['x-forwarded-for'] = `${realIp2}, ${proxyIp}`;
      wss.emit('connection', allowedConn, mockReq);
      await waitForConnectionProcessing();
      expect(allowedConn.close).not.toHaveBeenCalled();
    });

    it('should fallback to socket remoteAddress if header is missing', async () => {
      delete mockReq.headers['x-forwarded-for'];
      const ip1 = '10.0.0.9';
      const ip2 = '10.0.0.10';

      mockReq.socket.remoteAddress = ip1;

      // Exhaust rate limit for ip1
      for (let i = 0; i < 100; i++) {
        const conn: any = new EventEmitter();
        conn.close = jest.fn();
        wss.emit('connection', conn, mockReq);
      }

      const rejectedConn: any = new EventEmitter();
      rejectedConn.close = jest.fn();
      wss.emit('connection', rejectedConn, mockReq);
      await waitForConnectionProcessing();
      expect(rejectedConn.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');

      // Connection from ip2 should succeed
      const allowedConn: any = new EventEmitter();
      allowedConn.close = jest.fn();
      mockReq.socket.remoteAddress = ip2;
      wss.emit('connection', allowedConn, mockReq);
      await waitForConnectionProcessing();
      expect(allowedConn.close).not.toHaveBeenCalled();
    });
  });
});
