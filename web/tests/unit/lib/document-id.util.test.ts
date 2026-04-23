import { generateDocumentId, isPersistedDocumentId } from '@/lib/document-id.util';

describe('generateDocumentId', () => {
  const originalCrypto = globalThis.crypto;
  const originalGetBuiltinModule = process.getBuiltinModule;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });

    process.getBuiltinModule = originalGetBuiltinModule;
    jest.restoreAllMocks();
  });

  it('uses crypto.randomUUID when available', () => {
    const randomUUID = jest.fn(() => '550e8400-e29b-41d4-a716-446655440000');
    const getRandomValues = jest.fn();

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID,
        getRandomValues,
      },
    });

    expect(generateDocumentId()).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('uses crypto.getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = jest.fn((bytes: Uint8Array) => {
      bytes.set([
        0x55, 0x0e, 0x84, 0x00, 0xe2, 0x9b, 0x11, 0xd4, 0xa7, 0x16, 0x44, 0x66, 0x55, 0x44, 0x33,
        0x22,
      ]);
      return bytes;
    });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues,
      },
    });

    expect(generateDocumentId()).toBe('550e8400-e29b-41d4-a716-446655443322');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('falls back to Node crypto.randomFillSync when Web Crypto is unavailable', () => {
    const randomFillSync = jest.fn((bytes: Uint8Array) => {
      bytes.set([
        0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x00, 0x11, 0x22, 0x33, 0xde, 0xf0, 0x12, 0x34, 0x56,
        0x78,
      ]);
      return bytes;
    });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    process.getBuiltinModule = jest.fn((id: string) => {
      if (id === 'node:crypto') {
        return { randomFillSync };
      }
      return undefined;
    });

    expect(generateDocumentId()).toBe('12345678-9abc-4011-a233-def012345678');
    expect(randomFillSync).toHaveBeenCalledTimes(1);
  });

  it('throws when no secure randomness source is available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    process.getBuiltinModule = jest.fn(() => undefined);

    expect(() => generateDocumentId()).toThrow(
      'Secure random document ID generation is unavailable: neither Web Crypto nor Node crypto.randomFillSync is present.'
    );
  });
});

describe('isPersistedDocumentId', () => {
  it('accepts valid UUIDs and rejects non-UUID values', () => {
    expect(isPersistedDocumentId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isPersistedDocumentId('not-a-uuid')).toBe(false);
    expect(isPersistedDocumentId(null)).toBe(false);
    expect(isPersistedDocumentId(undefined)).toBe(false);
  });
});
