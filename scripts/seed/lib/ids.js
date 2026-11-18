'use strict';

const crypto = require('crypto');

/**
 * Stable seed ids.
 *
 * UUIDv5 over a fixed namespace and a stable key means the same fixture produces the
 * same document ids on every machine, so a screenshot, an e2e run, and a bug report can
 * name the same page. Version 5 matters: the API rejects document ids outside RFC 4122
 * versions 1-5.
 */
const NAMESPACE = '2f1a6b1e-9c3d-5a7e-8b2f-0d4c6e8a1b3d';

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function uuidv5(key) {
  const hash = crypto
    .createHash('sha1')
    .update(uuidToBytes(NAMESPACE))
    .update(key, 'utf8')
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

/** Every id the seed produces is namespaced by kind and stable key. */
function seedId(kind, key, profile) {
  const suffix = profile ? `${profile}:` : '';
  return uuidv5(`seed:v1:${suffix}${kind}:${key}`);
}

module.exports = { NAMESPACE, uuidv5, seedId };
