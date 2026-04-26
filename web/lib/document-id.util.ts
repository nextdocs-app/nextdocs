const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NodeCryptoModuleLike = {
  randomFillSync?: (buffer: Uint8Array) => Uint8Array | void;
};

type NodeProcessLike = {
  getBuiltinModule?: (id: string) => NodeCryptoModuleLike | undefined;
};

function getNodeRandomFillSync(): ((buffer: Uint8Array) => Uint8Array | void) | null {
  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeProcessLike }).process;
  const nodeCrypto = nodeProcess?.getBuiltinModule?.('node:crypto');

  return typeof nodeCrypto?.randomFillSync === 'function' ? nodeCrypto.randomFillSync : null;
}

function fillRandomBytes(bytes: Uint8Array): void {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return;
  }

  const nodeRandomFillSync = getNodeRandomFillSync();
  if (nodeRandomFillSync) {
    nodeRandomFillSync(bytes);
    return;
  }

  throw new Error(
    'Secure random document ID generation is unavailable: neither Web Crypto nor Node crypto.randomFillSync is present.'
  );
}

export function isPersistedDocumentId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isRealtimeEligibleDocumentId(value: string | null | undefined): value is string {
  return isPersistedDocumentId(value);
}

export function generateDocumentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  fillRandomBytes(bytes);

  // RFC 4122 UUID v4 bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
