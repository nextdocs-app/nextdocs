import {
  INVITE_TOKEN_STORAGE_KEY,
  forgetInviteToken,
  readInviteToken,
  readRememberedInviteToken,
  rememberInviteToken,
  stripUrlFragment,
} from '../../../lib/invite-token.util';

describe('readInviteToken', () => {
  it('reads the token from a leading-hash fragment', () => {
    expect(readInviteToken('#token=abc123')).toBe('abc123');
  });

  it('accepts a fragment without the leading hash', () => {
    expect(readInviteToken('token=abc123')).toBe('abc123');
  });

  it('reads the token when it is not the first fragment parameter', () => {
    expect(readInviteToken('#from=email&token=abc123')).toBe('abc123');
  });

  it('decodes a percent-encoded token', () => {
    expect(readInviteToken('#token=a%2Bb%2Fc')).toBe('a+b/c');
  });

  it('returns null for a missing, empty, or unrelated fragment', () => {
    expect(readInviteToken('')).toBeNull();
    expect(readInviteToken('#')).toBeNull();
    expect(readInviteToken('#token=')).toBeNull();
    expect(readInviteToken('#token=%20')).toBeNull();
    expect(readInviteToken('#other=value')).toBeNull();
  });
});

describe('stripUrlFragment', () => {
  const originalUrl = window.location.href;
  afterEach(() => {
    window.history.replaceState(null, '', originalUrl);
  });

  it('removes the fragment without touching the path or query', () => {
    window.history.replaceState(null, '', '/join?ref=mail#token=secret');

    stripUrlFragment();

    expect(window.location.pathname).toBe('/join');
    expect(window.location.search).toBe('?ref=mail');
    expect(window.location.hash).toBe('');
  });

  it('does nothing when there is no fragment', () => {
    window.history.replaceState(null, '', '/join');

    stripUrlFragment();

    expect(window.location.pathname).toBe('/join');
    expect(window.location.hash).toBe('');
  });
});

describe('invite token stash', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips a token for the rest of the tab', () => {
    rememberInviteToken('invite-token');

    expect(window.sessionStorage.getItem(INVITE_TOKEN_STORAGE_KEY)).toBe('invite-token');
    expect(readRememberedInviteToken()).toBe('invite-token');
  });

  it('reads null when nothing was stashed', () => {
    expect(readRememberedInviteToken()).toBeNull();
  });

  it('drops the token once it is spent', () => {
    rememberInviteToken('invite-token');

    forgetInviteToken();

    expect(readRememberedInviteToken()).toBeNull();
  });
});

describe('invite token stash when sessionStorage refuses to cooperate', () => {
  it('treats blocked reads and writes as no stash instead of interrupting sign-up', () => {
    const blocked = () => {
      throw new Error('storage is blocked');
    };
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);

    expect(() => rememberInviteToken('invite-token')).not.toThrow();
    expect(readRememberedInviteToken()).toBeNull();
    expect(() => forgetInviteToken()).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});
