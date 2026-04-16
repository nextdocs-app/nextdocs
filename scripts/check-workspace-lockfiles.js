#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const forbiddenLockfiles = [
  path.join(root, 'web', 'package-lock.json'),
  path.join(root, 'realtime', 'package-lock.json'),
];

const found = forbiddenLockfiles.filter((filePath) => fs.existsSync(filePath));

if (found.length > 0) {
  console.error('\nWorkspace lockfile policy violation detected.\n');
  console.error('Only the root package-lock.json is allowed in this npm workspace repository.');
  console.error('Remove these files and run npm install or npm ci from the repository root:\n');

  for (const filePath of found) {
    console.error(`- ${path.relative(root, filePath)}`);
  }

  console.error('');
  process.exit(1);
}

process.exit(0);
