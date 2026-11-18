'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./proc');

const SERVICES = ['api', 'web', 'realtime'];

/** Backward scan size for log tails; one read is enough for a normal session tail. */
const CHUNK_BYTES = 64 * 1024;

// Turbo shows/hides the cursor even when its stdout is a pipe (notably on shutdown).
// A detached child writes straight to the file descriptor, so strip control sequences
// on read rather than trying to write a sanitizer between the child and its file.
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*?(?:\u0007|\u001b\\)/g;

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

/**
 * One backward read of at most `limit` complete lines, or of everything after the newest
 * line `boundary` matches. `./nd logs` and the failure diagnostics used to read the whole
 * file: a session that ran for hours makes that the slow part of a command that prints 30
 * lines. The scan starts at EOF and stops as soon as it has what it needs.
 *
 * The first line of a partial read is dropped, because a chunk boundary can cut it in
 * half and half a line is worse than one line less. Whole-chunk decoding keeps a UTF-8
 * sequence that straddles the boundary from turning into replacement characters.
 */
function readTail(file, { limit = 100, boundary = null } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    let size = fs.fstatSync(fd).size;
    const chunks = [];
    let read = 0;
    let restarts = 0;
    for (;;) {
      if (read < size) {
        const length = Math.min(CHUNK_BYTES, size - read);
        const buffer = Buffer.allocUnsafe(length);
        const bytes = fs.readSync(fd, buffer, 0, length, size - read - length);
        if (bytes !== length) {
          // A new session truncated the file between the stat and this read. Decoding the
          // unread tail of an allocUnsafe buffer would print heap bytes as log output, so
          // restart from the new end (bounded, in case the file keeps shrinking).
          if (restarts >= 3) {
            throw new Error(`Could not read ${path.basename(file)}: it kept shrinking.`);
          }
          restarts += 1;
          size = fs.fstatSync(fd).size;
          chunks.length = 0;
          read = 0;
          continue;
        }
        chunks.unshift(buffer);
        read += length;
      }
      const text = chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8');
      // The whole file, or the whole tail: there is nothing older left to read.
      if (read >= size) return text;
      const lines = text.split('\n');
      lines.shift();
      if (boundary) {
        // Older sessions cannot contain the header this search is looking for, and every
        // line after the newest one is already in the buffer.
        if (lines.some((line) => boundary.test(line))) return text;
      } else if (lines.length > limit) {
        return text;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Never throws for a log that was never written; callers print a "start it" hint. */
function tailFile(service, limit = 100, root = ROOT) {
  const file = logFile(service, root);
  try {
    return { service, file, lines: tailText(readTail(file, { limit }), limit) };
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
    text = readTail(file, { boundary: sessionHeader(service) });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { service, file, lines: [], missing: true };
  }

  const lines = stripAnsi(text).replace(/\r\n/g, '\n').split('\n');
  const header = sessionHeader(service);
  let start = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (header.test(lines[index])) {
      start = index + 1;
      break;
    }
  }
  return { service, file, lines: tailText(lines.slice(start).join('\n'), limit) };
}

function sessionHeader(service) {
  return new RegExp(`^=== .* nextdocs .* ${service} ===$`);
}

module.exports = {
  SERVICES,
  beginLog,
  logFile,
  logsDir,
  readTail,
  stripAnsi,
  tailFile,
  tailSession,
  tailText,
};
