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
