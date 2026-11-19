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

const packageManager = String(packageJson.packageManager || '');
const pnpmPin = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager);
const pnpmVersion = pnpmPin ? pnpmPin[1] : null;
if (!pnpmPin) {
  errors.push('package.json packageManager must pin pnpm@<major.minor.patch>');
} else {
  const engineMatch = String((packageJson.engines && packageJson.engines.pnpm) || '').match(
    />=\s*(\d+\.\d+\.\d+)/
  );
  if (!engineMatch) {
    errors.push('package.json engines.pnpm must pin a minimum like ">=12.21.0"');
  } else if (engineMatch[1] !== pnpmPin[1]) {
    errors.push(
      `package.json engines.pnpm (${engineMatch[1]}) does not match packageManager (pnpm@${pnpmPin[1]})`
    );
  }
}

if (Array.isArray(packageJson.workspaces) && packageJson.workspaces.length > 0) {
  errors.push(
    'package.json#workspaces is ignored by pnpm; declare packages in pnpm-workspace.yaml'
  );
}

if (fs.existsSync(path.join(root, 'package-lock.json'))) {
  errors.push('package-lock.json must not exist; pnpm-lock.yaml is the only lockfile');
}

if (pnpmVersion) {
  for (const file of ['web/Dockerfile', 'realtime/Dockerfile']) {
    const pins = [...read(file).matchAll(/pnpm@(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
    if (pins.length === 0) {
      errors.push(`${file} does not install pnpm@${pnpmVersion}`);
    }
    for (const pin of pins) {
      if (pin !== pnpmVersion) {
        errors.push(
          `${file} installs pnpm@${pin}; package.json packageManager is pnpm@${pnpmVersion}`
        );
      }
    }
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

  const lines = contents.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!/uses:\s*pnpm\/action-setup@/.test(lines[index])) continue;
    const versionLine = lines
      .slice(index + 1, index + 6)
      .find((line) => /^\s*version:\s*/.test(line));
    const pin = versionLine && /version:\s*['"]?(\d+\.\d+\.\d+)/.exec(versionLine);
    if (!pin) {
      errors.push(
        `.github/workflows/${file} pnpm/action-setup has no pinned version; expected ${pnpmVersion || '<packageManager>'}`
      );
    } else if (pnpmVersion && pin[1] !== pnpmVersion) {
      errors.push(
        `.github/workflows/${file} sets up pnpm@${pin[1]}; package.json packageManager is pnpm@${pnpmVersion}`
      );
    }
  }

  if (
    /(^|\s)pnpm\s+(run|exec|install|--filter)/m.test(contents) &&
    !/uses:\s*pnpm\/action-setup@/.test(contents)
  ) {
    errors.push(`.github/workflows/${file} runs pnpm without pnpm/action-setup`);
  }
}

if (errors.length > 0) {
  console.error('Runtime version drift detected:\n');
  for (const error of errors) console.error(`- ${error}`);
  console.error(
    '\nUpdate .nvmrc / .java-version / package.json and the Dockerfiles/workflows together.'
  );
  process.exit(1);
}

console.log(
  `Runtime pins OK: Node ${nodeVersion}, pnpm ${pnpmVersion || 'unpinned'}, Java ${javaVersion}`
);
