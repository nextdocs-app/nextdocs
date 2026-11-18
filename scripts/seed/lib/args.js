'use strict';

const PROFILES = ['small', 'regular', 'large'];
const DEFAULT_PROFILE = 'regular';

const USAGE = `Usage: ./nd seed [small|regular|large] [options]

Seeds a fresh local database with a realistic organization. The full stack
(\`./nd dev\`) must be running, and both databases must be empty.

Options:
  --yes           Confirm non-interactively (required when stdin is not a TTY)
  --verify        Verify counts, content, anchors, chronology and search hits
  --verbose       Print every API call
  --help          Show this help

Accounts: every seeded user is <key>@nextdocs.test with password NextDocs!2026.
The demo login is alice@nextdocs.test (workspace owner).

Profiles: small (fast), regular (default), large (more members and pages)`;

function parseArgs(argv) {
  const args = {
    profile: DEFAULT_PROFILE,
    yes: false,
    verify: false,
    help: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--yes' || arg === '-y') {
      args.yes = true;
    } else if (arg === '--verify') {
      args.verify = true;
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown seed option: ${arg}\n\n${USAGE}`);
    } else if (PROFILES.includes(arg)) {
      args.profile = arg;
    } else {
      throw new Error(
        `Unknown seed profile: '${arg}'. Choose one of ${PROFILES.join(', ')}.\n\n${USAGE}`
      );
    }
  }

  return args;
}

module.exports = { PROFILES, DEFAULT_PROFILE, USAGE, parseArgs };
