'use strict';

const readline = require('readline');
const { warn } = require('./proc');

/**
 * Print exactly what a destructive command removes, then require either `--yes` or an
 * explicit interactive confirmation. A piped stdin without `--yes` fails instead of
 * consuming the next line of an unrelated script.
 */
async function confirmDestructive({ headline, details, yes }) {
  console.log('');
  console.log(headline);
  for (const detail of details) {
    console.log(`  - ${detail}`);
  }
  console.log('');

  if (yes) {
    warn('--yes supplied; continuing without a prompt.');
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error(
      'Refusing to continue: stdin is not a terminal. Re-run with --yes to confirm non-interactively.'
    );
    return false;
  }

  const answer = await question('Type "yes" to continue: ');
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Aborted. Nothing was changed.');
    return false;
  }
  return true;
}

function question(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

module.exports = { confirmDestructive, question };
