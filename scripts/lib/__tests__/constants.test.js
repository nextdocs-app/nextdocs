'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { ROOT } = require('../proc');
const { attachmentStoragePath } = require('../constants');

function withAttachmentOverride(value, fn) {
  const previous = process.env.ATTACHMENT_STORAGE_PATH;
  const cwd = process.cwd();
  process.env.ATTACHMENT_STORAGE_PATH = value;
  try {
    fn();
  } finally {
    process.chdir(cwd);
    if (previous === undefined) delete process.env.ATTACHMENT_STORAGE_PATH;
    else process.env.ATTACHMENT_STORAGE_PATH = previous;
  }
}

test('a relative attachment override resolves against the API working directory', () => {
  // `./nd` runs from the repo root while the API runs from `api/`; resolving the
  // override against the caller's cwd would make `db reset` delete another tree.
  withAttachmentOverride('./data/attachments', () => {
    assert.equal(attachmentStoragePath(), path.join(ROOT, 'api', 'data', 'attachments'));
    process.chdir(ROOT);
    assert.equal(attachmentStoragePath(), path.join(ROOT, 'api', 'data', 'attachments'));
    process.chdir(path.join(ROOT, 'api'));
    assert.equal(attachmentStoragePath(), path.join(ROOT, 'api', 'data', 'attachments'));
  });
});

test('an absolute attachment override is used as provided', () => {
  const absolute = path.join(ROOT, 'tmp', 'attachments');
  withAttachmentOverride(absolute, () => {
    assert.equal(attachmentStoragePath(), absolute);
  });
});
