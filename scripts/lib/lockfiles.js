'use strict';

const fs = require('fs');
const path = require('path');

// One lockfile for the whole workspace. pnpm reads the workspace from
// pnpm-workspace.yaml and ignores package.json#workspaces, so a lockfile next to a
// workspace manifest is always a stale second source of truth.
const FORBIDDEN_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'web/package-lock.json',
  'web/npm-shrinkwrap.json',
  'web/yarn.lock',
  'web/pnpm-lock.yaml',
  'realtime/package-lock.json',
  'realtime/npm-shrinkwrap.json',
  'realtime/yarn.lock',
  'realtime/pnpm-lock.yaml',
];

function findForbiddenLockfiles(root) {
  return FORBIDDEN_LOCKFILES.map((relativePath) => path.join(root, relativePath)).filter(
    (absolutePath) => fs.existsSync(absolutePath)
  );
}

module.exports = { FORBIDDEN_LOCKFILES, findForbiddenLockfiles };
