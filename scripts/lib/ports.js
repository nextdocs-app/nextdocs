'use strict';

const net = require('net');

/** The three ports one NextDocs instance needs, in start order. */
const PORT_NAMES = ['web', 'api', 'realtime'];

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Ask the OS for a port by binding 0 and releasing it. The window between release and
 * the child service binding is unavoidable without handing the listener over, but it
 * is short and a collision is reported by the service itself.
 */
function ephemeralPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host }, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Could not obtain an ephemeral port from the OS.'));
      });
    });
  });
}

/**
 * Reserve the three ports for one instance.
 *
 * `preferred` is tried first (the familiar 3000/8080/1234, or base + --port-offset).
 * A port another instance already recorded counts as taken even before that instance
 * binds it, which is what keeps two simultaneous first runs from picking the same
 * number. `strict` pins only the named services (or all three when `true`, for
 * --port-offset): a single ND_*_PORT must not force the other services to fail.
 */
async function allocatePorts({
  preferred = {},
  reserved = [],
  isFree = isPortFree,
  strict = false,
} = {}) {
  const strictNames = new Set(strict === true ? PORT_NAMES : Array.isArray(strict) ? strict : []);
  const taken = new Set([...reserved].map(Number));
  const ports = {};

  for (const name of PORT_NAMES) {
    const candidate = Number(preferred[name]);
    let chosen = null;

    if (candidate && !taken.has(candidate) && (await isFree(candidate))) {
      chosen = candidate;
    } else if (strictNames.has(name)) {
      throw new Error(
        `Port ${candidate || '(unset)'} for ${name} is already in use. ` +
          'Choose another --port-offset or ND_*_PORT value.'
      );
    } else {
      // A few attempts: the OS can hand back a port another instance recorded in the
      // same millisecond, and retrying is cheaper than failing the whole start.
      for (let attempt = 0; attempt < 20 && !chosen; attempt += 1) {
        const port = await ephemeralPort();
        if (!taken.has(port) && (await isFree(port))) chosen = port;
      }
      if (!chosen) {
        throw new Error(`Could not find a free ${name} port after 20 attempts.`);
      }
    }

    ports[name] = chosen;
    taken.add(chosen);
  }

  return ports;
}

/** Cheap "is something listening" probe for `./nd status`; never throws. */
function portOpen(port, { host = '127.0.0.1', timeoutMs = 400 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

module.exports = {
  PORT_NAMES,
  allocatePorts,
  ephemeralPort,
  isPortFree,
  portOpen,
};
