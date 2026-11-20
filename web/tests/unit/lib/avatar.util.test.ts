import { getApiBaseUrl } from '../../../lib/api-url.util';
import {
  AVATAR_BACKGROUNDS,
  AVATAR_TEXT_COLOR,
  buildInitialsAvatarDataUrl,
  getAvatarBackground,
  getAvatarInitials,
  hashSeed,
  resolveAvatarUrl,
} from '../../../lib/avatar.util';

describe('getAvatarInitials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['Ada Lovelace King', 'AL'],
    ['Ada', 'A'],
    ['   ', '?'],
    ['', '?'],
    [null, '?'],
    [undefined, '?'],
    ['santhosh.kumar@example.com', 'SK'],
    ['Santhosh-Kumar R', 'SK'],
    ['Åsa Öberg', 'ÅÖ'],
    ['  grace   hopper  ', 'GH'],
  ])('turns %p into %p', (name, expected) => {
    expect(getAvatarInitials(name)).toBe(expected);
  });

  it('keeps a single code point intact for names outside the BMP', () => {
    // Slicing the string by UTF-16 units would have left half an emoji here.
    expect(getAvatarInitials('🦄 Unicorn')).toBe('🦄U');
  });
});

describe('getAvatarBackground', () => {
  it('is stable for a seed, so every client paints the same colour', () => {
    const seed = '2f1c9c1e-7d4a-4b1f-9c55-1a2b3c4d5e6f';

    expect(getAvatarBackground(seed)).toBe(getAvatarBackground(seed));
    expect(AVATAR_BACKGROUNDS).toContain(getAvatarBackground(seed));
  });

  it('spreads a batch of user ids across the palette', () => {
    const colors = new Set(
      Array.from({ length: 120 }, (_, index) => getAvatarBackground(`user-${index}`))
    );

    expect(colors.size).toBeGreaterThan(9);
  });

  it('hashes to an unsigned integer', () => {
    expect(hashSeed('user-1')).toBeGreaterThanOrEqual(0);
    expect(hashSeed('user-1')).toBe(hashSeed('user-1'));
  });
});

describe('buildInitialsAvatarDataUrl', () => {
  it('encodes the same avatar as an image source', () => {
    const url = buildInitialsAvatarDataUrl('user-1', 'Ada Lovelace');
    const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));

    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(svg).toContain('>AL</text>');
    expect(svg).toContain(getAvatarBackground('user-1'));
    expect(svg).toContain(`fill="${AVATAR_TEXT_COLOR}"`);
    expect(svg).toContain('mix-blend-mode:overlay');
    // Two letter layers, matching the DOM component.
    expect(svg.match(/<text/g)).toHaveLength(2);
  });

  it('escapes markup that came in through the name', () => {
    const url = buildInitialsAvatarDataUrl('user-1', '<img src=x>');
    const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));

    expect(svg).toContain('&lt;');
    expect(svg).not.toContain('<img');
  });
});

describe('buildInitialsAvatarDataUrl', () => {
  it('falls back to the name for the hue when there is no seed', () => {
    const withoutSeed = buildInitialsAvatarDataUrl('', 'Ada Lovelace');
    const withSeed = buildInitialsAvatarDataUrl('ada-lovelace', 'Ada Lovelace');

    // Same person, same colour, whichever handle the caller happens to have.
    expect(decodeURIComponent(withoutSeed)).toContain(getAvatarBackground('Ada Lovelace'));
    expect(withSeed).not.toBe(withoutSeed);
    expect(decodeURIComponent(withoutSeed)).toContain('>AL<');
  });

  it('escapes the initials before they reach the markup', () => {
    const dataUrl = decodeURIComponent(buildInitialsAvatarDataUrl('seed', '<script>'));

    expect(dataUrl).not.toContain('<script>');
    expect(dataUrl).toContain('&lt;');
  });
});

describe('resolveAvatarUrl', () => {
  it('serves an uploaded photo from the API origin', () => {
    // The API returns a host-independent path, so without the base URL an <img>
    // would ask the web server for /api/... and get a 404 page.
    expect(resolveAvatarUrl('/api/v1/users/user-1/avatar?v=abc123')).toBe(
      `${getApiBaseUrl()}/api/v1/users/user-1/avatar?v=abc123`
    );
  });

  it('leaves absolute image sources alone', () => {
    expect(resolveAvatarUrl('https://provider.example/pic.png')).toBe(
      'https://provider.example/pic.png'
    );
    expect(resolveAvatarUrl('http://localhost:8080/api/x.png')).toBe(
      'http://localhost:8080/api/x.png'
    );
    const raster = 'data:image/webp;base64,UklGRg==';
    expect(resolveAvatarUrl(raster)).toBe(raster);
  });

  it('refuses a source that is not an image', () => {
    // The value comes back from the API and from an editable snapshot, so a stored
    // `javascript:` or HTML payload must fall back to initials rather than be rendered.
    expect(resolveAvatarUrl('javascript:alert(1)')).toBeNull();
    expect(resolveAvatarUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(resolveAvatarUrl('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toBeNull();
    expect(resolveAvatarUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('answers null for an account without a photo', () => {
    expect(resolveAvatarUrl(null)).toBeNull();
    expect(resolveAvatarUrl(undefined)).toBeNull();
    expect(resolveAvatarUrl('')).toBeNull();
  });
});
