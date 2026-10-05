import { jest } from '@jest/globals';
import request from 'supertest';
import { EventEmitter } from 'events';

const VALID_ROOM_ID = '11111111-1111-1111-1111-111111111111';

const WS_OPEN = 1;

const waitForConnectionProcessing = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Server', () => {
  let server: any;
  let wss: any;
  let cleanupInactiveRooms: any;
  let isOriginAllowed: any;
  let getClientIp: any;
  let fetchAccess: any;
  let setupWSConnectionMock: any;
  let updateConnectionAccessLevelMock: any;
  let memoryUsageSpy: any;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(async () => {
    jest.resetModules();

    await jest.unstable_mockModule('ws', () => {
      class MockWebSocketServer extends EventEmitter {
        clients: any = { size: 0 };
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

    await jest.unstable_mockModule('../../src/logger.js', () => ({
      __esModule: true,
      default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../../src/yjs-utils.js', () => ({
      __esModule: true,
      setupWSConnection: jest.fn(),
      updateConnectionAccessLevel: jest.fn(),
    }));

    await jest.unstable_mockModule('../../src/config.js', () => ({
      __esModule: true,
      default: {
        port: 1234,
        host: '0.0.0.0',
        apiBaseUrl: 'http://localhost:8080',
        corsOrigins: ['http://localhost:3000', 'http://192.168.*.*:3000'],
        logLevel: 'info',
        trustedProxies: ['127.0.0.1'],
        roomCleanupInterval: 300000,
        roomInactiveTimeout: 3600000,
        accessRevalidationIntervalMs: 5000,
        anonymousAccessRevalidationIntervalMs: 30000,
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

    const serverModule = await import('../../src/server.js');
    server = serverModule.server;
    wss = serverModule.wss;
    cleanupInactiveRooms = serverModule.cleanupInactiveRooms;
    isOriginAllowed = serverModule.isOriginAllowed;
    getClientIp = serverModule.getClientIp;
    fetchAccess = serverModule.fetchAccess;

    const yjsUtilsModule = await import('../../src/yjs-utils.js');
    setupWSConnectionMock = yjsUtilsModule.setupWSConnection;
    updateConnectionAccessLevelMock = yjsUtilsModule.updateConnectionAccessLevel;
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

    it('OPTIONS should handle CORS for allowed origin', async () => {
      const response = await request(server)
        .options('/any-route')
        .set('Origin', 'http://localhost:3000');
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('OPTIONS should not allow credentialed CORS for unauthorized origin', async () => {
      const response = await request(server)
        .options('/any-route')
        .set('Origin', 'http://192.168.evil.com:3000');
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('getClientIp', () => {
    it('normalizes IPv4-mapped IPv6 remote addresses', () => {
      const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} } as any;

      expect(getClientIp(req)).toBe('127.0.0.1');
    });

    it('returns the normalized forwarded client IP from a trusted proxy', () => {
      const req = {
        socket: { remoteAddress: '::ffff:127.0.0.1' },
        headers: { 'x-forwarded-for': '::ffff:203.0.113.9, 10.0.0.1' },
      } as any;

      expect(getClientIp(req)).toBe('203.0.113.9');
    });

    it('ignores X-Forwarded-For from untrusted peers', () => {
      const req = {
        socket: { remoteAddress: '::ffff:198.51.100.7' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      } as any;

      expect(getClientIp(req)).toBe('198.51.100.7');
    });
  });

  describe('fetchAccess', () => {
    it('forwards the client IP as X-Forwarded-For to the API', async () => {
      await fetchAccess(null, VALID_ROOM_ID, '203.0.113.9');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/documents/${VALID_ROOM_ID}/access-check`),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Forwarded-For': '203.0.113.9' }),
        })
      );
    });

    it('omits Authorization for anonymous callers and X-Forwarded-For for unknown IPs', async () => {
      await fetchAccess(null, VALID_ROOM_ID, 'unknown');

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(headers['X-Forwarded-For']).toBeUndefined();
    });

    it('treats 400 and 422 responses as definitive denials', async () => {
      for (const status of [400, 422]) {
        fetchMock.mockResolvedValueOnce({ ok: false, status, headers: new Headers() } as Response);
        await expect(fetchAccess(null, VALID_ROOM_ID, '203.0.113.9')).resolves.toEqual({
          status: 'denied',
        });
      }
    });

    it('reports 5xx responses as transient errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      } as Response);
      await expect(fetchAccess(null, VALID_ROOM_ID, '203.0.113.9')).resolves.toEqual({
        status: 'error',
      });
    });

    it('falls back to 60s when Retry-After is missing, invalid, or non-positive', async () => {
      for (const retryAfter of [undefined, 'soon', '0', '-5']) {
        const headers = new Headers();
        if (retryAfter !== undefined) {
          headers.set('retry-after', retryAfter);
        }
        fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers } as Response);
        await expect(fetchAccess(null, VALID_ROOM_ID, '203.0.113.9')).resolves.toEqual({
          status: 'rate_limited',
          retryAfterMs: 60000,
        });
      }
    });
  });

  describe('isOriginAllowed', () => {
    const patterns = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://192.168.*.*:3000',
      'http://10.*.*.*:3000',
      'http://172.16.*.*:3000',
    ];

    it('allows exact origin matches', () => {
      expect(isOriginAllowed('http://localhost:3000', patterns)).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:3000', patterns)).toBe(true);
    });

    it('allows valid IPv4 private LAN origins within patterns', () => {
      expect(isOriginAllowed('http://192.168.1.1:3000', patterns)).toBe(true);
      expect(isOriginAllowed('http://192.168.0.254:3000', patterns)).toBe(true);
      expect(isOriginAllowed('http://10.0.0.1:3000', patterns)).toBe(true);
      expect(isOriginAllowed('http://10.255.255.255:3000', patterns)).toBe(true);
      expect(isOriginAllowed('http://172.16.1.10:3000', patterns)).toBe(true);
    });

    it('rejects domain origins crossing dots or pretending to match IP prefixes', () => {
      expect(isOriginAllowed('http://192.168.evil.com:3000', patterns)).toBe(false);
      expect(isOriginAllowed('http://10.evil.com:3000', patterns)).toBe(false);
      expect(isOriginAllowed('http://172.16.evil.com:3000', patterns)).toBe(false);
      expect(isOriginAllowed('http://192.168.1.1.evil.com:3000', patterns)).toBe(false);
      expect(isOriginAllowed('http://evil192.168.1.1:3000', patterns)).toBe(false);
    });

    it('rejects numbers exceeding valid IPv4 octet bounds', () => {
      expect(isOriginAllowed('http://192.168.999.1:3000', patterns)).toBe(false);
      expect(isOriginAllowed('http://192.168.1.300:3000', patterns)).toBe(false);
    });

    it('rejects unlisted or invalid origins', () => {
      expect(isOriginAllowed('http://example.com:3000', patterns)).toBe(false);
      expect(isOriginAllowed('', patterns)).toBe(false);
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
      (mockConn as any).readyState = WS_OPEN;
      wss.clients.size = 0;
    });

    it('should accept connection with valid room ID', async () => {
      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();
      expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');
      expect(mockConn.close).not.toHaveBeenCalled();
    });

    it('should accept anonymous connection for a public share link without a token', async () => {
      mockReq.url = `/${VALID_ROOM_ID}`;
      mockReq.headers = { host: 'localhost:1234' };

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');
      expect(mockConn.close).not.toHaveBeenCalled();
      // Anonymous access-check carries no Authorization header.
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/documents/${VALID_ROOM_ID}/access-check`),
        expect.objectContaining({ method: 'GET' })
      );
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('should accept the Authorization header and forward it to access-check', async () => {
      mockReq.url = `/${VALID_ROOM_ID}`;
      mockReq.headers = { host: 'localhost:1234', authorization: 'Bearer header-token' };

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');
      expect(mockConn.close).not.toHaveBeenCalled();
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer header-token');
    });

    it('should prefer the Authorization header over the query token', async () => {
      mockReq.url = `/${VALID_ROOM_ID}?token=query-token`;
      mockReq.headers = { host: 'localhost:1234', authorization: 'Bearer header-token' };

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer header-token');
    });

    it('should treat a whitespace-only query token as anonymous', async () => {
      mockReq.url = `/${VALID_ROOM_ID}?token=%20%20%20`;
      mockReq.headers = { host: 'localhost:1234' };

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');
      expect(mockConn.close).not.toHaveBeenCalled();
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('should revalidate anonymous rooms lazily and authenticated rooms eagerly', async () => {
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');

      try {
        mockReq.url = `/${VALID_ROOM_ID}`;
        mockReq.headers = { host: 'localhost:1234' };
        wss.emit('connection', mockConn, mockReq);
        await waitForConnectionProcessing();
        expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 30000);

        setIntervalSpy.mockClear();
        const authedConn = new EventEmitter();
        (authedConn as any).close = jest.fn();
        (authedConn as any).readyState = WS_OPEN;
        mockReq.url = `/${VALID_ROOM_ID}?token=test-token`;
        wss.emit('connection', authedConn, mockReq);
        await waitForConnectionProcessing();
        expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 5000);
      } finally {
        setIntervalSpy.mockRestore();
      }
    });

    it('should update connection access level on revalidation downgrade', async () => {
      jest.useFakeTimers();
      try {
        mockReq.url = `/${VALID_ROOM_ID}`;
        mockReq.headers = { host: 'localhost:1234' };
        wss.emit('connection', mockConn, mockReq);
        await waitForConnectionProcessing();

        expect(setupWSConnectionMock).toHaveBeenCalledWith(mockConn, VALID_ROOM_ID, 'EDIT');

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              allowed: true,
              accessLevel: 'VIEW',
              owner: false,
            },
            error: null,
          }),
        } as Response);

        await jest.advanceTimersByTimeAsync(30000);
        await waitForConnectionProcessing();

        expect(updateConnectionAccessLevelMock).toHaveBeenCalledWith(
          mockConn,
          VALID_ROOM_ID,
          'VIEW'
        );
        expect(mockConn.close).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should keep connection open and back off on 429 rate limit during revalidation', async () => {
      jest.useFakeTimers();
      try {
        mockReq.url = `/${VALID_ROOM_ID}`;
        mockReq.headers = { host: 'localhost:1234' };
        wss.emit('connection', mockConn, mockReq);
        await waitForConnectionProcessing();

        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '60' }),
          json: async () => ({
            success: false,
            error: { code: 'RATE_LIMIT_EXCEEDED' },
          }),
        } as Response);

        await jest.advanceTimersByTimeAsync(30000);
        await waitForConnectionProcessing();

        // 429 must NOT close the connection
        expect(mockConn.close).not.toHaveBeenCalled();

        // Next interval fires at +30s: now is +60s, but nextBackoffUntil was set to now + 60s (+90s total).
        // So fetch should not be called again yet.
        const callsBefore = fetchMock.mock.calls.length;
        await jest.advanceTimersByTimeAsync(30000);
        await waitForConnectionProcessing();
        expect(fetchMock.mock.calls.length).toBe(callsBefore);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should close connection after consecutive revalidation errors', async () => {
      jest.useFakeTimers();
      try {
        mockReq.url = `/${VALID_ROOM_ID}`;
        mockReq.headers = { host: 'localhost:1234' };
        wss.emit('connection', mockConn, mockReq);
        await waitForConnectionProcessing();

        // 5 consecutive errors should trigger fail-close 1011
        for (let i = 0; i < 5; i++) {
          fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR' } }),
          } as Response);
          await jest.advanceTimersByTimeAsync(30000);
          await waitForConnectionProcessing();
        }

        expect(mockConn.close).toHaveBeenCalledWith(1011, 'Access check failed');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should close connection after consecutive revalidation rate limits', async () => {
      jest.useFakeTimers();
      try {
        mockReq.url = `/${VALID_ROOM_ID}`;
        mockReq.headers = { host: 'localhost:1234' };
        wss.emit('connection', mockConn, mockReq);
        await waitForConnectionProcessing();

        // 5 consecutive rate limits should trigger fail-close 1008
        for (let i = 0; i < 5; i++) {
          fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '1' }),
            json: async () => ({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } }),
          } as Response);
          await jest.advanceTimersByTimeAsync(30000);
          await waitForConnectionProcessing();
        }

        expect(mockConn.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should close connection when access is revoked during revalidation', async () => {
      jest.useFakeTimers();
      try {
        mockReq.url = `/${VALID_ROOM_ID}`;
        mockReq.headers = { host: 'localhost:1234' };
        wss.emit('connection', mockConn, mockReq);
        await waitForConnectionProcessing();

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

        await jest.advanceTimersByTimeAsync(30000);
        await waitForConnectionProcessing();

        expect(mockConn.close).toHaveBeenCalledWith(1008, 'Access revoked');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should reject anonymous connection when the share link is private', async () => {
      mockReq.url = `/${VALID_ROOM_ID}`;
      mockReq.headers = { host: 'localhost:1234' };
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

    it('closes with 1008 when the API rate limits the initial access check', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '30' }),
      } as Response);

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(mockConn.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
      expect(setupWSConnectionMock).not.toHaveBeenCalled();
    });

    it('closes with 1011 when the initial access check fails transiently', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      } as Response);

      wss.emit('connection', mockConn, mockReq);
      await waitForConnectionProcessing();

      expect(mockConn.close).toHaveBeenCalledWith(1011, 'Internal server error');
      expect(setupWSConnectionMock).not.toHaveBeenCalled();
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
        firstConn.readyState = WS_OPEN;
        wss.emit('connection', firstConn, mockReq);
        await waitForConnectionProcessing();

        expect(firstConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const secondConn: any = new EventEmitter();
        secondConn.close = jest.fn();
        secondConn.readyState = WS_OPEN;
        wss.emit('connection', secondConn, mockReq);
        await waitForConnectionProcessing();

        expect(secondConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(15001);

        const thirdConn: any = new EventEmitter();
        thirdConn.close = jest.fn();
        thirdConn.readyState = WS_OPEN;
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
        firstConn.readyState = WS_OPEN;
        wss.emit('connection', firstConn, mockReq);
        await waitForConnectionProcessing();

        expect(firstConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(15001);

        const secondConn: any = new EventEmitter();
        secondConn.close = jest.fn();
        secondConn.readyState = WS_OPEN;
        wss.emit('connection', secondConn, mockReq);
        await waitForConnectionProcessing();

        expect(secondConn.close).toHaveBeenCalledWith(1008, 'Access denied');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        cleanupInactiveRooms();

        const thirdConn: any = new EventEmitter();
        thirdConn.close = jest.fn();
        thirdConn.readyState = WS_OPEN;
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
      (mockConn as any).readyState = WS_OPEN;

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
      (mockConn as any).readyState = WS_OPEN;
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

    it('should ignore X-Forwarded-For if socket.remoteAddress is not a trusted proxy', async () => {
      mockReq.socket.remoteAddress = '203.0.113.195';
      mockReq.headers['x-forwarded-for'] = '198.51.100.1';

      // Exhaust rate limit for 203.0.113.195
      for (let i = 0; i < 100; i++) {
        const conn: any = new EventEmitter();
        conn.close = jest.fn();
        wss.emit('connection', conn, mockReq);
      }

      // Next connection should be rate limited based on 203.0.113.195, ignoring the spoofed XFF
      const rejectedConn: any = new EventEmitter();
      rejectedConn.close = jest.fn();
      wss.emit('connection', rejectedConn, mockReq);
      await waitForConnectionProcessing();
      expect(rejectedConn.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
    });
  });
});
