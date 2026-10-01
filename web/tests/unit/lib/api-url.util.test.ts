import {
  buildApiBaseUrl,
  buildRealtimeUrl,
  getApiBaseUrl,
  getRealtimeUrl,
} from '@/lib/api-url.util';

describe('api-url.util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_REALTIME_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('derives the API base from the current hostname for LAN testing', () => {
    expect(buildApiBaseUrl({ hostname: '192.168.1.7', protocol: 'http:' }, undefined)).toBe(
      'http://192.168.1.7:8080'
    );
  });

  it('derives the realtime URL from the current hostname', () => {
    expect(buildRealtimeUrl({ hostname: '192.168.1.7', protocol: 'http:' }, undefined)).toBe(
      'ws://192.168.1.7:1234'
    );
  });

  it('uses secure schemes when the page is served over https', () => {
    expect(buildApiBaseUrl({ hostname: '192.168.1.7', protocol: 'https:' }, undefined)).toBe(
      'https://192.168.1.7:8080'
    );
    expect(buildRealtimeUrl({ hostname: '192.168.1.7', protocol: 'https:' }, undefined)).toBe(
      'wss://192.168.1.7:1234'
    );
  });

  it('falls back to localhost without a host (SSR)', () => {
    expect(buildApiBaseUrl(null, undefined)).toBe('http://localhost:8080');
    expect(buildRealtimeUrl(null, undefined)).toBe('ws://localhost:1234');
  });

  it('prefers explicit env overrides when set', () => {
    expect(
      buildApiBaseUrl(
        { hostname: '192.168.1.7', protocol: 'http:' },
        'http://api.example.com:8080/'
      )
    ).toBe('http://api.example.com:8080');
    expect(
      buildRealtimeUrl({ hostname: '192.168.1.7', protocol: 'http:' }, 'wss://rt.example.com:1234/')
    ).toBe('wss://rt.example.com:1234');
  });

  it('getApiBaseUrl/getRealtimeUrl default to localhost in jsdom without env', () => {
    // jsdom default location is http://localhost/
    expect(getApiBaseUrl()).toBe('http://localhost:8080');
    expect(getRealtimeUrl()).toBe('ws://localhost:1234');
  });

  it('brackets unbracketed IPv6 hostnames for API and realtime URLs', () => {
    expect(buildApiBaseUrl({ hostname: '::1', protocol: 'http:' }, undefined)).toBe(
      'http://[::1]:8080'
    );
    expect(buildRealtimeUrl({ hostname: 'fe80::1', protocol: 'http:' }, undefined)).toBe(
      'ws://[fe80::1]:1234'
    );
  });

  it('preserves already-bracketed IPv6 hostnames without double-bracketing', () => {
    expect(buildApiBaseUrl({ hostname: '[::1]', protocol: 'http:' }, undefined)).toBe(
      'http://[::1]:8080'
    );
    expect(buildRealtimeUrl({ hostname: '[fe80::1]', protocol: 'http:' }, undefined)).toBe(
      'ws://[fe80::1]:1234'
    );
  });
});
