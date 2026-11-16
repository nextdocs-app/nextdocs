#!/usr/bin/env node

'use strict';

// CI, local setup, and production images must agree on runtime versions. The
// previous pipeline tested Node 24.14.1 and Java 21 while the Docker images ran
// Node 26 and Java 27/25, so a green build did not mean the shipped image worked.
//
// This check is intentionally simple: it reads the two source-of-truth files and
// compares the major version in every Dockerfile. Docker tags may use a major-only
// tag (node:24-trixie-slim) or the exact patch (node:24.14.1-alpine); both are
// accepted as long as the major matches.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  try {
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    errors.push(`missing ${relativePath}`);
    return '';
  }
}

function majorOf(version) {
  // Tags can carry a suffix (24.14.1-trixie-slim, 24-trixie-slim), so take the
  // leading digits instead of trusting a dot split to end at the major.
  const match = String(version)
    .trim()
    .match(/^(\d+)/);
  return match ? match[1] : String(version).trim();
}

const nodeVersion = read('.nvmrc').trim();
const javaVersion = read('.java-version').trim();
const packageJson = JSON.parse(read('package.json') || '{}');

if (!nodeVersion) {
  errors.push('.nvmrc is empty');
} else {
  const engine = packageJson.engines && packageJson.engines.node;
  const engineMatch = String(engine || '').match(/>=\s*(\d+\.\d+\.\d+)/);
  if (!engineMatch) {
    errors.push('package.json engines.node must pin a minimum version like ">=24.14.1"');
  } else if (engineMatch[1] !== nodeVersion) {
    errors.push(
      `package.json engines.node (${engineMatch[1]}) does not match .nvmrc (${nodeVersion})`
    );
  }
}

if (!javaVersion) {
  errors.push('.java-version is empty');
} else {
  const pom = read('api/pom.xml');
  const pomMatch = pom.match(/<java\.version>\s*([^<\s]+)\s*<\/java\.version>/);
  if (!pomMatch) {
    errors.push('api/pom.xml has no <java.version>');
  } else if (pomMatch[1] !== javaVersion) {
    errors.push(
      `api/pom.xml java.version (${pomMatch[1]}) does not match .java-version (${javaVersion})`
    );
  }
}

const nodeDockerfiles = ['web/Dockerfile', 'realtime/Dockerfile'];
for (const file of nodeDockerfiles) {
  const contents = read(file);
  const tags = [...contents.matchAll(/^\s*FROM\s+node:([^\s]+)/gim)].map((match) => match[1]);
  if (tags.length === 0) errors.push(`${file} has no node: base image`);
  for (const tag of tags) {
    if (majorOf(tag) !== majorOf(nodeVersion)) {
      errors.push(`${file} uses node:${tag}; .nvmrc is ${nodeVersion}`);
    }
  }
}

const apiDockerfile = read('api/Dockerfile');
const javaTags = [...apiDockerfile.matchAll(/(?:eclipse-temurin|temurin)[-:](\d+)/g)].map(
  (match) => match[1]
);
if (javaTags.length === 0) {
  errors.push('api/Dockerfile has no Temurin Java base image');
}
for (const tag of javaTags) {
  if (tag !== majorOf(javaVersion)) {
    errors.push(`api/Dockerfile uses Java ${tag}; .java-version is ${javaVersion}`);
  }
}

const workflowDir = path.join(root, '.github', 'workflows');
for (const file of fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))) {
  const contents = fs.readFileSync(path.join(workflowDir, file), 'utf8');
  if (/^\s*node-version:\s*['"]?\d/m.test(contents)) {
    errors.push(`.github/workflows/${file} hardcodes node-version; use node-version-file: .nvmrc`);
  }
  if (/^\s*java-version:\s*['"]?\d/m.test(contents)) {
    errors.push(
      `.github/workflows/${file} hardcodes java-version; use java-version-file: .java-version`
    );
  }
}

if (errors.length > 0) {
  console.error('Runtime version drift detected:\n');
  for (const error of errors) console.error(`- ${error}`);
  console.error('\nUpdate .nvmrc / .java-version and the Dockerfiles together.');
  process.exit(1);
}

console.log(`Runtime pins OK: Node ${nodeVersion}, Java ${javaVersion}`);
