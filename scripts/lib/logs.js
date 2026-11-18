'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./proc');

const SERVICES = ['api', 'web', 'realtime'];

// Turbo shows/hides the cursor even when its stdout is a pipe (notably on shutdown).
// A detached child writes straight to the file descriptor, so strip control sequences
// on read rather than trying to write a sanitizer between the child and its file.
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_ESCAPE, '');
}

/** Detached services write here; the directory is inside the worktree and gitignored. */
function logsDir(root = ROOT) {
  return path.join(root, '.nd', 'logs');
}

function logFile(service, root = ROOT) {
  if (!SERVICES.includes(service)) {
    throw new Error(`Unknown service '${service}'. Valid services: ${SERVICES.join(', ')}.`);
  }
  return path.join(logsDir(root), `${service}.log`);
}

/**
 * Open one service log for a new session and write its header. Each start replaces the
 * previous file: `tailSession` only ever reads the newest session, so older output was
 * never used, and truncating is what keeps the file from growing across restarts.
 * The caller owns the returned fd (a spawned child gets it as stdio, then it is closed
 * in the parent). Only call this once the service is known not to be running.
 */
function beginLog(service, instance, root = ROOT) {
  const file = logFile(service, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  try {
    const id = instance && instance.id ? instance.id : 'unknown';
    fs.writeSync(fd, `\n=== ${new Date().toISOString()} nextdocs ${id} ${service} ===\n`);
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
  return { service, file, fd };
}

/** Return the last `limit` lines, dropping the empty tail a trailing newline creates. */
function tailText(text, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Log line count must be a positive integer, received "${limit}".`);
  }
  const lines = stripAnsi(text).replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length > limit ? lines.slice(-limit) : lines;
}

/** Never throws for a log that was never written; callers print a "start it" hint. */
function tailFile(service, limit = 100, root = ROOT) {
  const file = logFile(service, root);
  try {
    return { service, file, lines: tailText(fs.readFileSync(file, 'utf8'), limit) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { service, file, lines: [], missing: true };
  }
}

/**
 * Failure diagnostics want this start's output, not the shutdown of the previous one.
 * `beginLog` writes one header per session; start reading after the last one.
 */
function tailSession(service, limit = 100, root = ROOT) {
  const file = logFile(service, root);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { service, file, lines: [], missing: true };
  }

  const lines = stripAnsi(text).replace(/\r\n/g, '\n').split('\n');
  const header = new RegExp(`^=== .* nextdocs .* ${service} ===$`);
  let start = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (header.test(lines[index])) {
      start = index + 1;
      break;
    }
  }
  return { service, file, lines: tailText(lines.slice(start).join('\n'), limit) };
}

module.exports = {
  SERVICES,
  beginLog,
  logFile,
  logsDir,
  stripAnsi,
  tailFile,
  tailSession,
  tailText,
};
