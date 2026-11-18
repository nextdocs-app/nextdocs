'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { flywayEnv, flywayUrl, migrationFiles } = require('../flyway');
const { apiDatabase } = require('../constants');

test('flyway env uses FLYWAY_* variables and an absolute filesystem location', () => {
  const saved = { ...process.env };
  delete process.env.SPRING_DATASOURCE_URL;
  delete process.env.SPRING_DATASOURCE_USERNAME;
  delete process.env.SPRING_DATASOURCE_PASSWORD;
  delete process.env.FLYWAY_USER;
  delete process.env.FLYWAY_PASSWORD;
  try {
    const env = flywayEnv();
    // The database name comes from this worktree's record, not from a hardcoded default:
    // a linked worktree owns `nextdocs_<id>`.
    assert.equal(env.FLYWAY_URL, `jdbc:postgresql://localhost:5433/${apiDatabase()}`);
    assert.equal(env.FLYWAY_USER, 'nextdocs');
    assert.equal(env.FLYWAY_PASSWORD, 'nextdocs');
    assert.match(
      env.FLYWAY_LOCATIONS,
      /^filesystem:(?:[A-Za-z]:)?\/.*\/api\/src\/main\/resources\/db\/migration$/
    );
    assert.ok(!env.FLYWAY_LOCATIONS.includes('\\'), 'Flyway locations use forward slashes');
    assert.notEqual(env.FLYWAY_CLEAN_DISABLED, 'false');
  } finally {
    process.env = saved;
  }
});

test('clean is the only path that enables Flyway clean', () => {
  const saved = { ...process.env };
  try {
    const env = flywayEnv({ clean: true });
    assert.equal(env.FLYWAY_CLEAN_DISABLED, 'false');
  } finally {
    process.env = saved;
  }
});

test('an inherited FLYWAY_CLEAN_DISABLED=false cannot lift the guard', () => {
  const saved = { ...process.env };
  try {
    process.env.FLYWAY_CLEAN_DISABLED = 'false';
    assert.equal(flywayEnv().FLYWAY_CLEAN_DISABLED, 'true');
    assert.equal(flywayEnv({ clean: true }).FLYWAY_CLEAN_DISABLED, 'false');
  } finally {
    process.env = saved;
  }
});

test('a JDBC URL is passed through and a libpq URL is converted', () => {
  const saved = { ...process.env };
  try {
    process.env.SPRING_DATASOURCE_URL = 'jdbc:postgresql://db.internal:6543/custom';
    assert.equal(flywayUrl(), 'jdbc:postgresql://db.internal:6543/custom');

    process.env.SPRING_DATASOURCE_URL = 'postgres://user:secret@db.internal:6543/custom';
    assert.equal(flywayUrl(), 'jdbc:postgresql://db.internal:6543/custom');
  } finally {
    process.env = saved;
  }
});

test('a libpq URL without a port means 5432 and keeps its query string', () => {
  const saved = { ...process.env };
  try {
    process.env.SPRING_DATASOURCE_URL = 'postgres://user:secret@db.internal/custom?sslmode=require';
    assert.equal(
      flywayUrl(),
      'jdbc:postgresql://db.internal:5432/custom?sslmode=require',
      'a remote URL must not inherit the dev container port, and sslmode has to survive'
    );
  } finally {
    process.env = saved;
  }
});

test('the local form ignores an inherited database URL', () => {
  const saved = { ...process.env };
  try {
    process.env.SPRING_DATASOURCE_URL = 'postgres://user:secret@db.internal:6543/custom';
    process.env.SPRING_DATASOURCE_USERNAME = 'someone_else';
    assert.equal(flywayUrl({ local: true }), `jdbc:postgresql://localhost:5433/${apiDatabase()}`);
    assert.equal(flywayEnv({ local: true }).FLYWAY_USER, 'nextdocs');
  } finally {
    process.env = saved;
  }
});

test('an explicit URL without a database name is rejected, not retargeted', () => {
  const saved = { ...process.env };
  try {
    // A libpq URL with no path is valid (the database defaults to the user name).
    // Substituting the dev container's database would report on a target nobody named.
    process.env.SPRING_DATASOURCE_URL = 'postgres://user:secret@127.0.0.1:5544';
    assert.throws(() => flywayUrl(), /not a supported Postgres URL/);
    assert.match(flywayUrl({ local: true }), /^jdbc:postgresql:\/\/localhost:5433\//);
  } finally {
    process.env = saved;
  }
});

test('migration files are listed in numeric order', () => {
  const files = migrationFiles();
  assert.ok(files.length > 0);
  for (let index = 1; index < files.length; index += 1) {
    assert.ok(files[index - 1].version < files[index].version);
  }
});
