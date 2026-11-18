'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { ROOT } = require('./proc');
const { peekInstance } = require('./instance');

/**
 * Local development infrastructure. The containers are shared by every worktree: one
 * Postgres published on 5433, Redis for Yhub rooms, Mailpit for invites. What differs
 * per worktree is resolved by `./instance` (database names, Redis prefix, service
 * ports), so this module exposes accessors instead of fixed database/port constants.
 */
const POSTGRES_CONTAINER = 'nextdocs-postgres';
const POSTGRES_IMAGE = 'postgres:15-alpine';
const POSTGRES_PORT = '5433';
const POSTGRES_USER = 'nextdocs';
const POSTGRES_PASSWORD = 'nextdocs';

const REDIS_CONTAINER = 'nextdocs-redis';
const REDIS_IMAGE = 'redis:7-alpine';
const REDIS_PORT = '6379';

const MAILPIT_CONTAINER = 'nextdocs-mailpit';
const MAILPIT_IMAGE = 'axllent/mailpit:v1.24';
const MAILPIT_SMTP_PORT = '1025';
const MAILPIT_WEB_PORT = '8025';

const PLACEHOLDER = 'CHANGE_ME_IN_PRODUCTION';

// Resolved once per process. `./nd dev` allocates and calls `setInstance`; every other
// command peeks at the recorded (or default) allocation without writing anything.
let currentInstance = null;

function getInstance() {
  if (!currentInstance) currentInstance = peekInstance();
  return currentInstance;
}

function setInstance(instance) {
  currentInstance = instance;
  return instance;
}

function apiDatabase() {
  return getInstance().database;
}

function yhubDatabase() {
  return getInstance().yhubDatabase;
}

function redisPrefix() {
  return getInstance().redisPrefix;
}

function isKeyEmptyOrPlaceholder(value) {
  return !value || !value.trim() || value === PLACEHOLDER;
}

function apiBaseUrl() {
  return process.env.NEXTDOCS_API_URL || `http://localhost:${getInstance().ports.api}`;
}

function realtimeBaseUrl() {
  return process.env.NEXTDOCS_REALTIME_URL || `http://localhost:${getInstance().ports.realtime}`;
}

function webBaseUrl() {
  return process.env.NEXTDOCS_WEB_URL || `http://localhost:${getInstance().ports.web}`;
}

/** WebSocket origin for this instance, derived from the HTTP base URL. */
function realtimeWsUrl() {
  return `${realtimeBaseUrl().replace(/^http/, 'ws')}/api/ws/v1/nextdocs`;
}

/**
 * Connection URL for the API database of this worktree, ignoring any inherited override.
 * `postgresUrl()` is what the services use; this is what the commands that name a
 * database in their prompt use, so the name they print is the one they touch.
 */
function localPostgresUrl() {
  return `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${apiDatabase()}`;
}

/**
 * Connection URL for the API database, overridden by `SPRING_DATASOURCE_URL` when set.
 * The Yhub database has its own {@link yhubPostgresUrl}: one override cannot describe
 * both, and returning it for either name would print the same URL twice.
 */
function postgresUrl() {
  if (!isKeyEmptyOrPlaceholder(process.env.SPRING_DATASOURCE_URL)) {
    return process.env.SPRING_DATASOURCE_URL;
  }
  return localPostgresUrl();
}

/**
 * The Yhub database of this worktree, ignoring any inherited override. Destructive
 * commands use this: the database they name in their prompt and the one they touch
 * have to be the same one.
 */
function localYhubPostgresUrl() {
  return `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${yhubDatabase()}`;
}

/**
 * The database the realtime service will actually use. `./nd dev` passes POSTGRES; a
 * separate `db` invocation falls back to the instance's local database.
 */
function yhubPostgresUrl() {
  return isKeyEmptyOrPlaceholder(process.env.POSTGRES)
    ? localYhubPostgresUrl()
    : process.env.POSTGRES;
}

/** Host from either a JDBC or a libpq URL; null when the value cannot be parsed. */
function hostOf(databaseUrl) {
  if (!databaseUrl) return null;
  const jdbc = /^jdbc:postgresql:\/\/([^/:?]+)/i.exec(databaseUrl);
  if (jdbc) return jdbc[1];
  const libpq = /^postgres(?:ql)?:\/\/(?:[^@/]*@)?([^/:?]+)/i.exec(databaseUrl);
  if (libpq) return libpq[1];
  return null;
}

function isLoopbackHost(host) {
  if (!host) return false;
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1' || value === '0.0.0.0') return true;
  // `startsWith('127.')` would call a resolvable name such as `127.corp.example` a
  // loopback host and wave a remote database past the local-only guard; only a real
  // IPv4 literal in 127/8 is loopback.
  return net.isIPv4(value) && value.split('.')[0] === '127';
}

/**
 * Destructive commands are for the developer container, never a shared database. An
 * explicit escape hatch keeps a deliberate remote reset possible without making it the
 * default a copied command would hit.
 *
 * `includeYhub` also checks `POSTGRES`, the realtime database. A reset touches both, and
 * checking them one after the other would already have dropped the first before the
 * second refused.
 */
function assertLocalDatabase(action, { includeYhub = false } = {}) {
  const targets = [{ variable: 'SPRING_DATASOURCE_URL', host: hostOf(postgresUrl()) }];
  if (includeYhub) targets.push({ variable: 'POSTGRES', host: hostOf(yhubPostgresUrl()) });

  const remote = targets.filter((target) => !isLoopbackHost(target.host));
  if (remote.length === 0) return;
  const described = remote.map((target) => `${target.variable} host '${target.host}'`).join(', ');

  if (process.env.NEXTDOCS_ALLOW_REMOTE_DB === '1') {
    console.warn(
      `\x1b[33mWARNING: ${action} is targeting non-loopback Postgres ${described}. ` +
        'NEXTDOCS_ALLOW_REMOTE_DB=1 removed the local-only guard.\x1b[0m'
    );
    return;
  }
  throw new Error(
    `${action} refuses to touch non-loopback database ${described}. ` +
      'This command is for the local Docker container. ' +
      'Set NEXTDOCS_ALLOW_REMOTE_DB=1 only if you really mean to destroy that database.'
  );
}

/**
 * Attachment storage directory, resolved the way the API resolves it: the env override
 * when present, otherwise `app.attachments.storage-path` from application.properties
 * (default `./data/attachments`) relative to the API's working directory (`api/` for
 * `./nd dev`). Each worktree has its own checkout, so the default path is already
 * per-instance; the env override exists for unusual layouts.
 */
function attachmentStoragePath() {
  const fromEnv = (process.env.ATTACHMENT_STORAGE_PATH || '').trim();
  const raw = fromEnv || defaultAttachmentStoragePath() || './data/attachments';
  // Always relative to the API's working directory, never to wherever `./nd` happens to
  // run: the API is started with cwd `api/` by `./nd dev` and by the container, so a
  // relative override has to mean that same directory here. Resolving it against the
  // repo root would make `./nd db reset` delete a different tree than the one the API
  // writes to. An absolute override ignores the base.
  return path.resolve(path.join(ROOT, 'api'), raw);
}

function defaultAttachmentStoragePath() {
  const propertiesPath = path.join(
    ROOT,
    'api',
    'src',
    'main',
    'resources',
    'application.properties'
  );
  try {
    const contents = fs.readFileSync(propertiesPath, 'utf8');
    const match = /^app\.attachments\.storage-path=(.*)$/m.exec(contents);
    if (!match) return null;
    const value = match[1].trim();
    const envTemplate = /^\$\{[^:}]+:([^}]*)\}$/.exec(value);
    return envTemplate ? envTemplate[1] : value;
  } catch {
    return null;
  }
}

module.exports = {
  POSTGRES_CONTAINER,
  POSTGRES_IMAGE,
  POSTGRES_PORT,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  REDIS_CONTAINER,
  REDIS_IMAGE,
  REDIS_PORT,
  MAILPIT_CONTAINER,
  MAILPIT_IMAGE,
  MAILPIT_SMTP_PORT,
  MAILPIT_WEB_PORT,
  PLACEHOLDER,
  getInstance,
  setInstance,
  apiDatabase,
  yhubDatabase,
  redisPrefix,
  isKeyEmptyOrPlaceholder,
  apiBaseUrl,
  realtimeBaseUrl,
  webBaseUrl,
  realtimeWsUrl,
  postgresUrl,
  localPostgresUrl,
  localYhubPostgresUrl,
  yhubPostgresUrl,
  hostOf,
  isLoopbackHost,
  assertLocalDatabase,
  attachmentStoragePath,
};
