'use strict';

const crypto = require('crypto');

/**
 * The mark key @y/prosemirror uses for an overlapping comment mark: the mark name plus
 * an eight-character suffix of the thread id's digest. This must stay byte-identical to
 * `commentMarkKey` in `realtime/src/anchor.ts`; the anchor endpoint writes that key, and
 * the seed's verification reads it back.
 */
function commentMarkKey(threadId) {
  const digest = crypto.createHash('sha256').update(threadId, 'utf8').digest('base64');
  return `comment--${digest.slice(0, 8)}`;
}

module.exports = { commentMarkKey };
