'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  beginLog,
  logFile,
  logsDir,
  readTail,
  stripAnsi,
  tailFile,
  tailSession,
  tailText,
} = require('../logs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nd-logs-'));
}

test('tailText keeps the newest lines and ignores the trailing newline', () => {
  assert.deepEqual(tailText('one\ntwo\nthree\n', 2), ['two', 'three']);
  assert.deepEqual(tailText('only\n', 10), ['only']);
  assert.deepEqual(tailText('', 10), []);
  assert.deepEqual(tailText('a\r\nb\r\n', 10), ['a', 'b']);
  assert.deepEqual(tailText('a\nb\nc', 1), ['c']);
});

test('tailText strips terminal control sequences from detached logs', () => {
  assert.equal(stripAnsi('\u001b[?25hready\u001b[0m'), 'ready');
  assert.deepEqual(tailText('one\u001b[?25h\ntwo\n', 10), ['one', 'two']);
  assert.deepEqual(tailText('\u001b[31mred\u001b[0m\n', 10), ['red']);
});

test('tailText rejects a bad line count', () => {
  assert.throws(() => tailText('a\n', 0), /positive integer/);
  assert.throws(() => tailText('a\n', 2.5), /positive integer/);
});

test('beginLog writes a session header and tailFile reads it back', () => {
  const root = tempRoot();
  const first = beginLog('api', { id: 'agent_one' }, root);
  assert.equal(first.file, logFile('api', root));
  fs.writeSync(first.fd, 'line one\nline two\n');
  fs.closeSync(first.fd);

  const tail = tailFile('api', 10, root);
  assert.equal(tail.file, logFile('api', root));
  assert.equal(tail.missing, undefined);
  assert.ok(tail.lines.some((line) => /nextdocs agent_one api/.test(line)));
  assert.ok(tail.lines.includes('line one'));
  assert.ok(tail.lines.includes('line two'));
});

test('beginLog replaces the previous session so the log does not grow across starts', () => {
  const root = tempRoot();
  const first = beginLog('api', { id: 'agent_one' }, root);
  fs.writeSync(first.fd, 'old line\n'.repeat(1000));
  fs.closeSync(first.fd);

  const second = beginLog('api', { id: 'agent_one' }, root);
  fs.writeSync(second.fd, 'new line\n');
  fs.closeSync(second.fd);

  const text = fs.readFileSync(logFile('api', root), 'utf8');
  assert.ok(!text.includes('old line'));
  assert.equal(text.match(/nextdocs agent_one api/g).length, 1);
  assert.ok(text.length < 200);
});

test('tailSession starts after the newest session header', () => {
  const root = tempRoot();
  const first = beginLog('api', { id: 'agent_one' }, root);
  fs.writeSync(first.fd, 'old line\n');
  fs.closeSync(first.fd);

  const second = beginLog('api', { id: 'agent_one' }, root);
  fs.writeSync(second.fd, 'new line\n');
  fs.closeSync(second.fd);

  assert.deepEqual(tailSession('api', 10, root).lines, ['new line']);
});

test('tailFile reports a missing log instead of throwing', () => {
  const root = tempRoot();
  const tail = tailFile('web', 5, root);
  assert.equal(tail.missing, true);
  assert.deepEqual(tail.lines, []);
  assert.equal(tail.file, path.join(logsDir(root), 'web.log'));
});

test('readTail stops once it has the requested lines', () => {
  const root = tempRoot();
  const file = logFile('api', root);
  fs.mkdirSync(logsDir(root), { recursive: true });
  // Two chunks' worth of lines, so "stopped early" is observable: the returned text must
  // be shorter than the file.
  fs.writeFileSync(file, `${'padding line\n'.repeat(20_000)}last line\n`);
  const size = fs.statSync(file).size;

  const text = readTail(file, { limit: 5 });
  assert.ok(text.length < size / 2, `read ${text.length} of ${size} bytes`);
  assert.ok(text.endsWith('last line\n'));
});

test('tailFile reads the last lines of a log larger than one chunk', () => {
  const root = tempRoot();
  const first = beginLog('api', { id: 'agent_one' }, root);
  const bulk = Array.from({ length: 20_000 }, (_, index) => `bulk line ${index}`).join('\n');
  fs.writeSync(first.fd, `${bulk}\nfinal line \u2014 with a dash\n`);
  fs.closeSync(first.fd);

  const tail = tailFile('api', 3, root);
  assert.deepEqual(tail.lines, [
    'bulk line 19998',
    'bulk line 19999',
    'final line \u2014 with a dash',
  ]);
});

test('tailSession stops at the newest header instead of reading older sessions', () => {
  const root = tempRoot();
  const file = logFile('api', root);
  fs.mkdirSync(logsDir(root), { recursive: true });
  // An older session far beyond one chunk, then the current one at the end.
  const older = ['=== 2026-01-01T00:00:00.000Z nextdocs agent_one api ==='];
  for (let index = 0; index < 20_000; index += 1) older.push(`old line ${index}`);
  fs.writeFileSync(
    file,
    [
      ...older,
      '=== 2026-01-02T00:00:00.000Z nextdocs agent_one api ===',
      'new line one',
      'new line two',
      '',
    ].join('\n')
  );
  const size = fs.statSync(file).size;

  const text = readTail(file, { boundary: /^=== .* nextdocs .* api ===$/ });
  assert.ok(text.length < size / 2, `read ${text.length} of ${size} bytes`);
  assert.deepEqual(tailSession('api', 10, root).lines, ['new line one', 'new line two']);
});

test('stripAnsi keeps the visible label of an OSC 8 hyperlink', () => {
  assert.equal(stripAnsi('\u001b]8;;https://example.com\u001b\\docs\u001b]8;;\u001b\\'), 'docs');
});
