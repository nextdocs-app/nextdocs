/**
 * lint-staged config, invoked by the Husky `pre-commit` hook.
 *
 * The scope mirrors CI (.github/workflows/ci-*.yml):
 *   - web / realtime -> Prettier, then ESLint --fix, using each workspace's own config
 *   - api            -> Spotless (palantirJavaFormat)
 *
 * lint-staged parses each command with string-argv and spawns it directly (no shell), so:
 *   - tasks receive absolute file paths, which keeps workspace commands valid from the root
 *   - Java files go through `scripts/hooks.js java-spotless`, because spotless-maven-plugin
 *     can only be scoped to a single file via -DspotlessIdeHook
 *
 * `.husky/pre-commit` runs lint-staged with --concurrent=false, which guarantees the
 * top-to-bottom task order below (Prettier must finish before ESLint --fix runs on the file).
 */

const path = require('path');

const HOOKS_SCRIPT = path.join(__dirname, 'scripts', 'hooks.js');

const prettier = 'prettier --write --ignore-unknown';
const spotless = `${JSON.stringify(process.execPath)} ${JSON.stringify(HOOKS_SCRIPT)} java-spotless`;

module.exports = {
  'web/**/*.{ts,tsx,js,mjs,cjs,json,md}': prettier,
  'realtime/**/*.{ts,js,mjs,cjs,json,md}': prettier,

  'web/**/*.{ts,tsx,js,mjs,cjs}': 'npm run lint -w web -- --fix',
  'realtime/**/*.{ts,js,mjs,cjs}': 'npm run lint -w realtime -- --fix',

  'api/**/*.java': spotless,
};
