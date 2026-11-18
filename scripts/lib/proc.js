'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const COLOR = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  reset: '\x1b[0m',
};

function info(message) {
  console.log(message);
}

function success(message) {
  console.log(`${COLOR.green}${message}${COLOR.reset}`);
}

function warn(message) {
  console.warn(`${COLOR.yellow}${message}${COLOR.reset}`);
}

function error(message) {
  console.error(`${COLOR.red}${message}${COLOR.reset}`);
}

let runStdoutToStderr = false;

/** JSON mode reserves the parent's stdout for one document; child output goes to stderr. */
function redirectRunStdout(toStderr) {
  runStdoutToStderr = Boolean(toStderr);
}

/**
 * Echo and run a shell command with inherited stdio.
 *
 * Kept in one module because both `nd.js` and the `db` commands depend on the exact
 * cwd/exit behaviour: a failed command must stop the caller unless it opts out.
 */
function run(command, opts = {}) {
  console.log(`${COLOR.blue}> ${command}${COLOR.reset}`);
  const result = spawnSync(command, {
    stdio: runStdoutToStderr ? ['inherit', 2, 'inherit'] : 'inherit',
    shell: true,
    cwd: opts.cwd || ROOT,
    env: opts.env || process.env,
  });
  if (opts.exitOnError !== false && result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
  return result.status;
}

/** Run a command without echoing it; callers own the failure message. */
function runSilent(command, opts = {}) {
  return spawnSync(command, {
    shell: true,
    cwd: opts.cwd || ROOT,
    stdio: 'pipe',
    timeout: opts.timeout,
    env: opts.env || process.env,
    input: opts.input,
  });
}

/** Synchronous sleep for the container-wait loops (`./nd dev` is synchronous). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  ROOT,
  COLOR,
  info,
  success,
  warn,
  error,
  run,
  runSilent,
  redirectRunStdout,
  sleepSync,
  sleep,
};
