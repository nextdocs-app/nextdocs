#!/usr/bin/env node

// Codecov resolves report paths against the repository root, but Jest writes
// them relative to the workspace it ran in (`SF:src/anchor.ts`), which would
// either land under the wrong tree or stay unmatched. Rebase them once, before
// upload, and refuse to hand Codecov a report whose paths do not resolve.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workspace = process.argv[2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!workspace) fail('usage: node scripts/coverage-paths.js <workspace> [lcov-path]');

const report = path.resolve(root, workspace, process.argv[3] || 'coverage/lcov.info');

if (!fs.existsSync(report)) fail(`Coverage report not found: ${path.relative(root, report)}`);

const prefix = `${workspace}/`;
const missing = [];
let skipped = 0;
let rebased = 0;

const lines = fs.readFileSync(report, 'utf8').split('\n');
const rewritten = lines.map((line) => {
  if (!line.startsWith('SF:')) return line;

  const source = line.slice(3);
  // Keep a second run a no-op instead of stacking another prefix on, but still
  // verify the path: a file deleted since the first run must be reported.
  if (source.startsWith(prefix)) {
    if (!fs.existsSync(path.resolve(root, source))) missing.push(source);
    else skipped += 1;
    return line;
  }

  const absolute = path.resolve(root, workspace, source);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!fs.existsSync(absolute)) missing.push(relative);

  rebased += 1;
  return `SF:${relative}`;
});

if (missing.length > 0) {
  fail(
    `${missing.length} covered file(s) do not exist at the rebased path, which would upload ` +
      `zeroed paths to Codecov:\n  ${missing.slice(0, 10).join('\n  ')}`
  );
}

if (rebased + skipped === 0) fail(`${path.relative(root, report)} has no SF: entries.`);

fs.writeFileSync(report, rewritten.join('\n'));

console.log(
  rebased === 0
    ? `Already repository-relative, nothing to do: ${path.relative(root, report)}`
    : `Rebased ${rebased} path(s) onto the repository root: ${path.relative(root, report)}`
);
