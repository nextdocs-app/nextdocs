#!/usr/bin/env node

/**
 * Git hook entrypoints. The files in `.husky/` are thin sh wrappers that exec this script.
 *
 *   pre-commit          lint-staged: Prettier + ESLint + Spotless for staged files
 *   commit-msg <file>   enforce the commit subject convention
 *   verify              run the CI-equivalent checks for the services the branch touches
 *
 * Bypass a hook with `SKIP_HOOKS=1 git commit`, `HUSKY=0`, or git's own
 * `--no-verify`. Hooks are also skipped when CI is detected.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const isWin = process.platform === 'win32';
const mvnw = isWin ? 'mvnw.cmd' : './mvnw';
const LOCKFILE_SCRIPT = path.join(ROOT, 'scripts', 'check-workspace-lockfiles.js');

// Commit subject convention: "<area>: <description>", e.g.
// "editor: Add alert block", "build(deps): bump jest", "api/schema: Add migration".
const MAX_SUBJECT_LENGTH = 100;
const SUBJECT_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]*(\([^)]+\))?: \S/;
const GENERATED_SUBJECTS = [/^Merge\b/, /^Revert\b/, /^fixup!/, /^squash!/];

// Root files that can change how the JS workspaces build or verify.
const ROOT_JS_PATTERNS = [
  /^package(-lock)?\.json$/,
  /^turbo\.json$/,
  /^tsconfig\.base\.json$/,
  /^\.prettierrc$/,
  /^lint-staged\.config\.js$/,
  /^\.husky\//,
  /^scripts\//,
];

const COLOR = { red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', reset: '\x1b[0m' };

function info(message) {
  console.log(message);
}

function warn(message) {
  console.warn(`${COLOR.yellow}${message}${COLOR.reset}`);
}

function error(message) {
  console.error(`${COLOR.red}${message}${COLOR.reset}`);
}

function shouldSkip(hookName) {
  if (process.env.HUSKY === '0') return 'HUSKY=0';
  if (process.env.CI) return 'CI is set';

  const skip = (process.env.SKIP_HOOKS || '').trim();
  if (!skip) return null;
  if (['1', 'true', 'all'].includes(skip.toLowerCase())) return 'SKIP_HOOKS=1';

  const names = skip.split(',').map((name) => name.trim());
  return names.includes(hookName) ? `SKIP_HOOKS=${skip}` : null;
}

function binary(name) {
  return path.join(ROOT, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);
}

function display(command) {
  return command.startsWith(`${ROOT}${path.sep}`) ? command.slice(ROOT.length + 1) : command;
}

function run(command, args, options = {}) {
  info(`${COLOR.blue}> ${display(command)} ${args.join(' ')}${COLOR.reset}`);
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd || ROOT,
    // Node cannot execute .cmd shims without a shell on Windows.
    shell: isWin && /\.(cmd|bat)$/i.test(command),
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.error) {
    error(`  failed to run ${display(command)}: ${result.error.message}`);
    return { status: 1, seconds };
  }

  info(`  (${seconds}s)`);
  return { status: result.status === null ? 1 : result.status, seconds };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * lint-staged creates a backup stash before running tasks and normally drops it again.
 * When it cannot restore the original state (for example when a tracked file is
 * permanently "modified" because of CRLF line endings), it keeps the stash on purpose
 * and leaves the tracked files reset to HEAD — so the stash is the only copy of that work.
 */
function listBackupStashes() {
  // %gs is the reflog subject (lint-staged's message); %s would be the stash commit subject.
  const output = git(['stash', 'list', '--format=%gd%x09%H%x09%gs']);
  if (!output) return [];

  return output
    .split('\n')
    .filter((line) => line.includes('lint-staged automatic backup'))
    .map((line) => {
      const [ref, hash] = line.split('\t');
      return { ref, hash };
    });
}

function checkWorkspaceLockfiles() {
  if (!fs.existsSync(LOCKFILE_SCRIPT)) return 0;
  return run(process.execPath, [LOCKFILE_SCRIPT]).status;
}

function runPreCommit() {
  const skip = shouldSkip('pre-commit');
  if (skip) {
    warn(`pre-commit skipped (${skip})`);
    return 0;
  }

  if (checkWorkspaceLockfiles() !== 0) {
    error('✖ pre-commit blocked: remove the workspace lockfile(s) listed above.');
    return 1;
  }

  const lintStaged = binary('lint-staged');
  if (!fs.existsSync(lintStaged)) {
    error('✖ pre-commit blocked: dependencies are not installed. Run `npm ci` from the repo root.');
    return 1;
  }

  // --concurrent=false keeps the lint-staged task order deterministic: Prettier writes the
  // file first, then ESLint --fix runs on the formatted output.
  const backupsBefore = new Set(listBackupStashes().map((stash) => stash.hash));
  const { status } = run(lintStaged, ['--concurrent', 'false', '--allow-empty']);
  if (status === 0) return 0;

  error('✖ pre-commit blocked: resolve the reported files and commit again.');

  const leftovers = listBackupStashes().filter((stash) => !backupsBefore.has(stash.hash));
  if (leftovers.length > 0) {
    const { ref } = leftovers[0];
    warn(`  lint-staged kept a backup stash at ${ref} because it could not restore.`);
    info('  That usually means a tracked file stays permanently "modified" (line endings).');
    info(`  Inspect it with \`git stash show -p ${ref}\`, restore it with`);
    info(`  \`git stash apply --index ${ref}\`, or discard it with \`git stash drop ${ref}\`.`);
  }

  return status;
}

/**
 * Formats staged Java files with Spotless. spotless-maven-plugin only supports file-level
 * scoping through `-DspotlessIdeHook=<file>`, so this runs Maven once per file (about 2s
 * each) instead of reformatting the whole module and touching unstaged work.
 */
function runJavaSpotless() {
  const files = process.argv.slice(3);
  if (files.length === 0) return 0;

  if (!fs.existsSync(path.join(API_DIR, 'pom.xml'))) {
    warn('Skipping Spotless: api/pom.xml was not found.');
    return 0;
  }

  for (const file of files) {
    const { status } = run(
      mvnw,
      ['-q', '-B', 'spotless:apply', `-DspotlessIdeHook=${file}`, '--no-transfer-progress'],
      { cwd: API_DIR }
    );

    if (status !== 0) {
      error(`✖ Spotless failed for ${path.relative(ROOT, file)}`);
      return status;
    }
  }

  return 0;
}

function stripComments(contents) {
  const kept = [];
  let afterScissors = false;

  for (const line of contents.split(/\r?\n/)) {
    if (/^#\s-+\s>8\s-+/.test(line)) {
      afterScissors = true;
      continue;
    }
    if (afterScissors) continue;
    if (line.startsWith('#')) continue;
    kept.push(line);
  }

  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  return kept;
}

function runCommitMsg(messageFile) {
  const skip = shouldSkip('commit-msg');
  if (skip) return 0;

  const file = messageFile || path.join(ROOT, '.git', 'COMMIT_EDITMSG');
  if (!fs.existsSync(file)) return 0;

  const lines = stripComments(fs.readFileSync(file, 'utf8'));
  if (lines.length === 0) return 0; // git rejects an empty message on its own

  const subject = lines[0].trim();
  if (GENERATED_SUBJECTS.some((pattern) => pattern.test(subject))) return 0;

  const problems = [];
  if (!SUBJECT_PATTERN.test(subject)) problems.push('missing an "<area>: " prefix');
  if (subject.length > MAX_SUBJECT_LENGTH) {
    problems.push(`${subject.length} characters long (max ${MAX_SUBJECT_LENGTH})`);
  }
  if (lines.length > 1 && lines[1].trim() !== '') {
    problems.push('missing a blank line between the subject and the body');
  }
  if (problems.length === 0) return 0;

  error(`✖ commit message rejected: ${problems.join('; ')}`);
  info(`    subject: ${subject}`);
  info('  Expected "<area>: <description>", for example:');
  info('    editor: Add inline code highlight to toolbar.');
  info('    api/schema: Add document nesting migrations.');
  info('  Bypass once with `git commit --no-verify` or `SKIP_HOOKS=1 git commit`.');
  return 1;
}

function diffNames(range) {
  const output = git(['diff', '--name-only', '--diff-filter=ACMRD', range]);
  return output === null ? null : output.split('\n').filter(Boolean);
}

function defaultBranchBase(sha) {
  const configured = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const candidates = [configured, 'origin/main', 'origin/master'].filter(Boolean);
  for (const ref of [...new Set(candidates)]) {
    if (git(['rev-parse', '--verify', '--quiet', ref]) === null) continue;
    const base = git(['merge-base', ref, sha]);
    if (base) return base;
  }
  return null;
}

function localBranchChangedFiles(explicitBase) {
  const head = git(['rev-parse', 'HEAD']);
  if (!head) return null;

  let base = null;
  if (explicitBase) {
    if (git(['rev-parse', '--verify', '--quiet', explicitBase]) !== null) {
      base = git(['merge-base', explicitBase, head]) || explicitBase;
    }
  } else {
    base = defaultBranchBase(head);
  }

  return base ? diffNames(`${base}..HEAD`) : null;
}

function classify(files) {
  const targets = { web: false, realtime: false, api: false };

  for (const file of files) {
    if (file.startsWith('web/')) targets.web = true;
    else if (file.startsWith('realtime/')) targets.realtime = true;
    else if (file.startsWith('api/')) targets.api = true;
    else if (ROOT_JS_PATTERNS.some((pattern) => pattern.test(file))) {
      targets.web = true;
      targets.realtime = true;
    }
  }

  return targets;
}

function runChecks(files) {
  if (checkWorkspaceLockfiles() !== 0) {
    error('✖ checks blocked: remove the workspace lockfile(s) listed above.');
    return 1;
  }

  if (files === null) info('Could not determine the changed files, so every service is checked.');

  const targets = files === null ? { web: true, realtime: true, api: true } : classify(files);
  const jsPackages = [targets.web ? 'web' : null, targets.realtime ? 'realtime' : null].filter(
    Boolean
  );

  if (jsPackages.length === 0 && !targets.api) {
    info('✔ no build-affecting changes to verify');
    return 0;
  }

  const failures = [];

  if (jsPackages.length > 0) {
    const turbo = binary('turbo');
    if (!fs.existsSync(turbo)) {
      warn('Skipping JS checks: dependencies are not installed. Run `npm ci` from the repo root.');
      failures.push(`${jsPackages.join(' + ')} (turbo not installed)`);
    } else {
      const filters = jsPackages.map((pkg) => `--filter=${pkg}`);
      // --force disables the Turborepo cache. Verify must never replay a cached
      // (possibly stale) result — a stale "success" would hide a failure.
      const { status } = run(turbo, ['run', 'format', 'lint', 'test', '--force', ...filters]);
      if (status !== 0) failures.push(`${jsPackages.join(' + ')} format/lint/test`);
    }
  }

  if (targets.api) {
    const { status } = run(mvnw, ['-B', 'spotless:check', 'test', '--no-transfer-progress'], {
      cwd: API_DIR,
    });
    if (status !== 0) failures.push('api spotless:check/test');
  }

  if (failures.length > 0) {
    error(`✖ checks failed: ${failures.join(', ')}`);
    info('  Fix them and run `npm run verify` again.');
    return 1;
  }

  info('✔ checks passed');
  return 0;
}

function runVerify(explicitBase) {
  info('Running format/lint/test checks against the local branch diff.');
  return runChecks(localBranchChangedFiles(explicitBase));
}

const COMMANDS = {
  'pre-commit': runPreCommit,
  'commit-msg': () => runCommitMsg(process.argv[3]),
  'java-spotless': runJavaSpotless,
  verify: () => runVerify(process.argv[3]),
};

function usage() {
  info('Usage: node scripts/hooks.js <pre-commit|commit-msg <file>|verify [base]>');
  info('  pre-commit    lint-staged for staged files (run by .husky/pre-commit)');
  info('  commit-msg    validate a commit message file (run by .husky/commit-msg)');
  info('  verify [base] format/lint/test the services the branch touches (npm run verify)');
  info('  java-spotless <files...>  internal: Spotless runner used by lint-staged.config.js');
}

const hookName = process.argv[2];
const command = COMMANDS[hookName];

if (!command) {
  usage();
  process.exit(1);
}

process.exit(command());
