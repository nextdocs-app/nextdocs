'use strict';

const crypto = require('crypto');
const { psql, queryValue } = require('../../lib/containers');
const { apiDatabase } = require('../../lib/constants');

/** Quote a value for the identity/backdate SQL the seed generates itself. */
function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlDate(value) {
  return value === null || value === undefined
    ? 'NULL'
    : `${sqlString(new Date(value).toISOString())}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runSql(sql, database = apiDatabase()) {
  return psql(database, sql);
}

function queryValueFrom(sql, database = apiDatabase()) {
  return queryValue(database, sql);
}

function queryRows(sql, database = apiDatabase()) {
  const output = psql(database, sql).trim();
  if (!output) return [];
  return output.split('\n').map((line) => line.split('|'));
}

module.exports = {
  sqlString,
  sqlDate,
  sha256Hex,
  runSql,
  queryValueFrom,
  queryRows,
};
