import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

describe('Config', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.REDIS;
    delete process.env.POSTGRES;
    delete process.env.API_BASE_URL;
    delete process.env.JWT_SECRET;
    delete process.env.YHUB_SERVICE_TOKEN;
    delete process.env.MAX_DOC_SIZE_BYTES;
    delete process.env.SWEEP_INTERVAL_MS;
    delete process.env.CORS_ORIGIN;
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.CORS_ORIGINS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('provides sensible development defaults', async () => {
    const config = await import('../../src/config.js');
    expect(config.ORG).toBe('nextdocs');
    expect(config.PORT).toBe(1234);
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
    expect(config.POSTGRES_URL).toBe('postgres://nextdocs:nextdocs@localhost:5433/nextdocs_yhub');
    expect(config.API_BASE_URL).toBe('http://localhost:8080');
    expect(config.CORS_ORIGINS).toContain('http://localhost:3000');
    expect(config.JWT_SECRET).toBe('dev-jwt-secret');
    expect(config.YHUB_SERVICE_TOKEN).toBe('dev-yhub-service-token');
    expect(config.MAX_DOC_SIZE_BYTES).toBe(16 * 1024 * 1024);
    expect(config.SWEEP_INTERVAL_MS).toBe(30_000);
  });

  it('falls back to the legacy CORS_ORIGINS name', async () => {
    process.env.CORS_ORIGINS = 'http://legacy.example, http://second.example';

    const config = await import('../../src/config.js');

    expect(config.CORS_ORIGINS).toEqual(['http://legacy.example', 'http://second.example']);
  });

  it('prefers the split CORS names over the legacy one', async () => {
    process.env.CORS_ORIGIN = 'http://current.example';
    process.env.CORS_ORIGINS = 'http://legacy.example';

    const config = await import('../../src/config.js');

    expect(config.CORS_ORIGINS).toEqual(['http://current.example']);
  });

  it('verifies tokens with the JWT secret exactly as configured', async () => {
    // The API signs with the configured bytes; trimming would reject every token
    // whenever the deployment value carries surrounding whitespace.
    process.env.JWT_SECRET = '  spaced-secret-value-of-enough-length  ';

    const config = await import('../../src/config.js');

    expect(config.JWT_SECRET).toBe('  spaced-secret-value-of-enough-length  ');
  });

  it('still trims the service token comparison value', async () => {
    process.env.YHUB_SERVICE_TOKEN = '  a-service-token-value  ';

    const config = await import('../../src/config.js');

    expect(config.YHUB_SERVICE_TOKEN).toBe('a-service-token-value');
  });

  it('validates UUID regex', async () => {
    const { UUID_REGEX } = await import('../../src/config.js');
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    // A room key is the exact string, so a second casing would be a second room.
    expect(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000')).toBe(false);
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
  });

  it('refuses to start in production without secrets', async () => {
    process.env.NODE_ENV = 'production';
    await expect(import('../../src/config.js')).rejects.toThrow(/JWT_SECRET is required/);
  });

  it('refuses to start in production with a published default secret', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(40);
    process.env.YHUB_SERVICE_TOKEN = 'dev-yhub-service-token';
    await expect(import('../../src/config.js')).rejects.toThrow(
      /YHUB_SERVICE_TOKEN still has a development default/
    );
  });

  it('refuses a short production secret', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'too-short';
    process.env.YHUB_SERVICE_TOKEN = 'b'.repeat(40);
    await expect(import('../../src/config.js')).rejects.toThrow(
      /JWT_SECRET must be at least 32 bytes/
    );
  });

  it('starts in production with strong secrets', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(40);
    process.env.YHUB_SERVICE_TOKEN = 'b'.repeat(40);
    const config = await import('../../src/config.js');
    expect(config.JWT_SECRET).toBe('a'.repeat(40));
    expect(config.YHUB_SERVICE_TOKEN).toBe('b'.repeat(40));
  });

  it('rejects a non-positive numeric setting', async () => {
    process.env.PORT = 'not-a-port';
    await expect(import('../../src/config.js')).rejects.toThrow(/PORT must be an integer >= 0/);
  });
});
