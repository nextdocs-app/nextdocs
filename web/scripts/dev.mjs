#!/usr/bin/env node
// Cross-platform `next dev -p <port>`: npm scripts cannot expand ${VAR:-default} on
// Windows, and ./nd allocates a different port per git worktree.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nextBin = path.join(
  path.dirname(require.resolve('next/package.json')),
  'dist',
  'bin',
  'next'
);

const requested = process.env.ND_WEB_PORT;
// Prevent Next's .env.local from overriding the allocated instance ports.
if (requested !== undefined) {
  process.env.NEXT_PUBLIC_API_URL = '';
  process.env.NEXT_PUBLIC_REALTIME_URL = '';
}
// A typo must not silently fall back to 3000: that is another worktree's port, and
// Next would either fail to bind or answer for the wrong stack. Port 0 is refused too:
// it asks the OS for an ephemeral port, which nothing else in the worktree knows about.
if (requested !== undefined && !/^[1-9]\d*$/.test(requested)) {
  console.error(`ND_WEB_PORT must be a port number, received "${requested}".`);
  process.exit(1);
}

// `-p` only when this worktree allocated a port: without `./nd`, `next dev` keeps its own
// default, and its `PORT`/extra-argument handling stays exactly as Next defines it.
const args = ['dev'];
if (requested !== undefined) args.push('-p', requested);
args.push(...process.argv.slice(2));

const child = spawn(process.execPath, [nextBin, ...args], { stdio: 'inherit' });

// `./nd stop` signals this wrapper and waits for it, so a child that ignores the signal
// cannot be allowed to keep the wrapper (and the stop) alive forever.
const SIGNAL_GRACE_MS = 5000;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
    setTimeout(() => {
      child.kill('SIGKILL');
      process.exit(0);
    }, SIGNAL_GRACE_MS).unref();
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
