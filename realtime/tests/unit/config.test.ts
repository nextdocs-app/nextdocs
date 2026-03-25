import { jest } from '@jest/globals';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use default values when environment variables are missing', async () => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.CORS_ORIGINS;
    delete process.env.LOG_LEVEL;
    delete process.env.ROOM_CLEANUP_INTERVAL;
    delete process.env.ROOM_INACTIVE_TIMEOUT;
    delete process.env.ACCESS_REVALIDATION_INTERVAL_MS;

    const config = (await import('../../src/config')).default;

    expect(config.port).toBe(1234);
    expect(config.host).toBe('0.0.0.0');
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
    expect(config.logLevel).toBe('info');
    expect(config.roomCleanupInterval).toBe(300000);
    expect(config.roomInactiveTimeout).toBe(3600000);
    expect(config.accessRevalidationIntervalMs).toBe(5000);
  });

  it('should parse environment variables correctly', async () => {
    process.env.PORT = '8080';
    process.env.HOST = '127.0.0.1';
    process.env.CORS_ORIGINS = 'http://example.com,http://test.com';
    process.env.LOG_LEVEL = 'debug';
    process.env.ROOM_CLEANUP_INTERVAL = '60000';
    process.env.ROOM_INACTIVE_TIMEOUT = '120000';
    process.env.ACCESS_REVALIDATION_INTERVAL_MS = '15000';

    const config = (await import('../../src/config')).default;

    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.corsOrigins).toEqual(['http://example.com', 'http://test.com']);
    expect(config.logLevel).toBe('debug');
    expect(config.roomCleanupInterval).toBe(60000);
    expect(config.roomInactiveTimeout).toBe(120000);
    expect(config.accessRevalidationIntervalMs).toBe(15000);
  });

  it('should trim CORS origins', async () => {
    process.env.CORS_ORIGINS = ' http://example.com , http://test.com ';
    const config = (await import('../../src/config')).default;
    expect(config.corsOrigins).toEqual(['http://example.com', 'http://test.com']);
  });

  it('should filter out empty CORS origins', async () => {
    process.env.CORS_ORIGINS = 'http://example.com,, ,http://test.com';
    const config = (await import('../../src/config')).default;
    expect(config.corsOrigins).toEqual(['http://example.com', 'http://test.com']);
  });

  it('should fallback to default log level for invalid value', async () => {
    process.env.LOG_LEVEL = 'invalid_level';
    const config = (await import('../../src/config')).default;
    expect(config.logLevel).toBe('info');
  });

  it('should throw error for invalid PORT', async () => {
    process.env.PORT = '-1';
    await expect(import('../../src/config')).rejects.toThrow('Invalid PORT');

    resetEnv();
    process.env.PORT = '70000';
    await expect(import('../../src/config')).rejects.toThrow('Invalid PORT');

    resetEnv();
    process.env.PORT = 'abc';
    await expect(import('../../src/config')).rejects.toThrow('Invalid PORT');
  });

  it('should throw error for invalid ROOM_CLEANUP_INTERVAL', async () => {
    process.env.ROOM_CLEANUP_INTERVAL = '-5';
    await expect(import('../../src/config')).rejects.toThrow('Invalid ROOM_CLEANUP_INTERVAL');
  });

  it('should throw error for invalid ROOM_INACTIVE_TIMEOUT', async () => {
    process.env.ROOM_INACTIVE_TIMEOUT = '0';
    await expect(import('../../src/config')).rejects.toThrow('Invalid ROOM_INACTIVE_TIMEOUT');
  });

  it('should throw error for invalid ACCESS_REVALIDATION_INTERVAL_MS', async () => {
    process.env.ACCESS_REVALIDATION_INTERVAL_MS = '0';
    await expect(import('../../src/config')).rejects.toThrow(
      'Invalid ACCESS_REVALIDATION_INTERVAL_MS'
    );
  });

  it('should throw error for invalid MAX_PAYLOAD', async () => {
    process.env.MAX_PAYLOAD = '-1';
    await expect(import('../../src/config')).rejects.toThrow('Invalid MAX_PAYLOAD');
  });

  it('should throw error for invalid MAX_CONNS_PER_IP', async () => {
    process.env.MAX_CONNS_PER_IP = '0';
    await expect(import('../../src/config')).rejects.toThrow('Invalid MAX_CONNS_PER_IP');
  });

  it('should throw error for invalid MAX_GLOBAL_CONNS', async () => {
    process.env.MAX_GLOBAL_CONNS = '-100';
    await expect(import('../../src/config')).rejects.toThrow('Invalid MAX_GLOBAL_CONNS');
  });

  it('should throw error for invalid MAX_CONN_RATE_PER_MIN', async () => {
    process.env.MAX_CONN_RATE_PER_MIN = '0';
    await expect(import('../../src/config')).rejects.toThrow('Invalid MAX_CONN_RATE_PER_MIN');
  });

  it('should throw error for invalid MAX_MSG_RATE_PER_SEC', async () => {
    process.env.MAX_MSG_RATE_PER_SEC = '-10';
    await expect(import('../../src/config')).rejects.toThrow('Invalid MAX_MSG_RATE_PER_SEC');
  });

  it('should throw error for invalid MEMORY_THRESHOLD', async () => {
    process.env.MEMORY_THRESHOLD = 'invalid';
    await expect(import('../../src/config')).rejects.toThrow('Invalid MEMORY_THRESHOLD');
  });

  function resetEnv() {
    jest.resetModules();
    process.env = { ...originalEnv };
  }
});
