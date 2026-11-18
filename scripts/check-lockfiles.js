#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { findForbiddenLockfiles } = require('./lib/lockfiles');

const root = path.resolve(__dirname, '..');
const found = findForbiddenLockfiles(root);
const missingRootLockfile = !fs.existsSync(path.join(root, 'pnpm-lock.yaml'));

if (found.length > 0 || missingRootLockfile) {
  console.error('\nWorkspace lockfile policy violation detected.\n');

  for (const filePath of found) {
    console.error(`- remove ${path.relative(root, filePath)}`);
  }
  if (missingRootLockfile) {
    console.error('- the root pnpm-lock.yaml is missing');
  }

  console.error('\nOnly the root pnpm-lock.yaml is allowed in this pnpm workspace repository.');
  console.error(
    'Run `pnpm install` (or `pnpm install --frozen-lockfile`) from the repository root.\n'
  );
  process.exit(1);
}

process.exit(0);
