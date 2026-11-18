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

function sessionHeader(service) {
  return new RegExp(`^=== .* nextdocs .* ${service} ===$`);
}

/**
 * Open one service log for a new session and write its header. Each start replaces the
 * previous session, which is what keeps the file from growing across restarts.
 *
 * The replacement is a rename, not an in-place truncate: the child inherits the new
 * file's descriptor, while a reader that opened the old path keeps one complete
 * generation instead of observing a file that was emptied and rewritten underneath it.
 * The caller owns the returned fd (a spawned child gets it as stdio, then it is closed
 * in the parent). Only call this once the service is known not to be running.
 */
function beginLog(service, instance, root = ROOT) {
  const file = logFile(service, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const id = instance && instance.id ? instance.id : 'unknown';
  const temporary = `${file}.${process.pid}.session`;
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeSync(fd, `\n=== ${new Date().toISOString()} nextdocs ${id} ${service} ===\n`);
    fs.renameSync(temporary, file);
  } catch (err) {
    fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
    throw new Error(`Could not start a new ${service} log at ${file}: ${err.message}`);
  }
  return { service, file, fd };
}

/** Lines with the trailing blank tail a newline leaves behind removed. */
function completeLines(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Return the last `limit` lines, dropping the empty tail a trailing newline creates. */
function tailText(text, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Log line count must be a positive integer, received "${limit}".`);
  }
  const lines = completeLines(stripAnsi(text));
  return lines.length > limit ? lines.slice(-limit) : lines;
}

/**
 * Read backwards until the requested complete lines are available. Blank lines do not
 * count: a session that ends with an empty tail must not make the caller stop before it
 * reaches the real last lines.
 *
 * Returns `{ text, atStart }`; `atStart` says the read covers the file from its first
 * byte, which is what lets `tailSession` validate the session header in its known place.
 */
function readTail(file, { limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Log line count must be a positive integer, received "${limit}".`);
  }
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
          // A file truncated in place (an older CLI, or a hand-edited log) shrank between
          // the stat and this read. Decoding the unread tail of an allocUnsafe buffer
          // would print heap bytes as log output, so restart from the new end (bounded,
          // in case the file keeps shrinking).
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
      const text = Buffer.concat(chunks).toString('utf8');
      const atStart = read >= size;
      // One extra line covers a partial first line and the lines the caller will drop.
      if (atStart || completeLines(text).length > limit) {
        return { text, atStart };
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
    const { text } = readTail(file, { limit });
    return { service, file, lines: tailText(text, limit) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { service, file, lines: [], missing: true };
  }
}

/**
 * Failure diagnostics want this start's output, not the shutdown of the previous one.
 * The header is only stripped when the read starts at the file's first byte: a line that
 * merely looks like a header inside service output must not hide output.
 */
function tailSession(service, limit = 100, root = ROOT) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Log line count must be a positive integer, received "${limit}".`);
  }
  const file = logFile(service, root);
  let read;
  try {
    read = readTail(file, { limit: limit + 2 });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { service, file, lines: [], missing: true };
  }

  let lines = completeLines(stripAnsi(read.text));
  if (read.atStart && lines[0] === '' && sessionHeader(service).test(lines[1] || '')) {
    lines = lines.slice(2);
  }
  const text = lines.join('\n');
  return { service, file, lines: tailText(text, limit) };
}

module.exports = {
  SERVICES,
  beginLog,
  logFile,
  logsDir,
  readTail,
  sessionHeader,
  stripAnsi,
  tailFile,
  tailSession,
  tailText,
};
