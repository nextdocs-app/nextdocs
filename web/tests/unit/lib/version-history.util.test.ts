import { buildYHubApiBaseUrl, YHUB_ORG } from '../../../lib/version-history.util';

describe('buildYHubApiBaseUrl', () => {
  it('maps the websocket origin onto the HTTP API prefix', () => {
    expect(buildYHubApiBaseUrl('ws://localhost:1234')).toBe('http://localhost:1234/api');
    expect(buildYHubApiBaseUrl('wss://docs.example.test/socket')).toBe(
      'https://docs.example.test/socket/api'
    );
  });

  it('preserves an HTTP realtime URL instead of downgrading it', () => {
    expect(buildYHubApiBaseUrl('https://docs.example.test/realtime')).toBe(
      'https://docs.example.test/realtime/api'
    );
    expect(buildYHubApiBaseUrl('http://localhost:1234')).toBe('http://localhost:1234/api');
  });

  it('drops a trailing slash and query/hash from the configured socket URL', () => {
    expect(buildYHubApiBaseUrl('ws://192.168.1.7:1234/?token=leak#x')).toBe(
      'http://192.168.1.7:1234/api'
    );
  });

  it('keeps the organisation the realtime server actually serves', () => {
    expect(YHUB_ORG).toBe('nextdocs');
  });
});
