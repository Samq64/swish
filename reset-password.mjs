#!/usr/bin/env node

/**
 * Manual password reset script. Resets a user's password in the production
 * (remote) D1 database after verifying the user exists.
 * Usage: node reset-password.mjs <username> <new_password>
 *
 * The pepper comes from the PEPPER env var (how the deployment provides it):
 *   PEPPER=... node reset-password.mjs alice NewPass123
 *
 * IMPORTANT: the app hashes/verifies with the deployment's PEPPER secret (see
 * src/lib/server/auth.js). If production has a PEPPER set, you MUST pass the
 * same value or the user is locked out after the reset.
 */

import { hashPassword } from './src/lib/server/auth.js';
import { execFileSync } from 'child_process';
import { createInterface } from 'readline/promises';

// --- tiny ANSI helpers (skip when not a TTY or NO_COLOR is set) --------------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const dim = paint('2');

const die = (msg) => {
  console.error(red(msg));
  process.exit(1);
};

const [username, password] = process.argv.slice(2);
const pepper = process.env.PEPPER;

if (!username || !password) {
  die('Usage: node reset-password.mjs <username> <new_password>');
}
if (password.length < 8) {
  die('Error: password must be at least 8 characters');
}
// Refuse to run without the pepper: hashing without it would lock the user out.
if (!pepper) {
  die('Error: PEPPER is not set. Run with PEPPER=<deployment-secret> to avoid locking the user out.');
}

/** Quote a string as a SQLite literal, escaping embedded single quotes. */
const sqlQuote = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** Ask a yes/no question; defaults to no, and to no on non-interactive stdin. */
async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

// Verify the user exists before the destructive write, so a typo'd username
// fails loudly instead of silently overwriting 0 rows.
// execFileSync (no shell) + quoted literal keeps username injection-safe.
// --json sends logs to stderr; stdout is [{ results, success, meta }].
let row;
try {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'swish', '--remote', '--json',
    '--command', `SELECT username FROM users WHERE username = ${sqlQuote(username)} LIMIT 1;`,
  ]);
  const parsed = JSON.parse(out);
  row = (Array.isArray(parsed) ? parsed[0]?.results : parsed.results)?.[0];
} catch (err) {
  die(`Error querying production DB: ${err.message}`);
}
if (!row) die(`Error: user '${username}' not found in production database`);
console.log(green(`✓ Found user '${username}' in production`));

const pw = await hashPassword(password, pepper);
// hash/salt are base64url (no quotes); username is escaped for safety.
const sql =
  `UPDATE users SET pw_hash = '${pw.hash}', pw_salt = '${pw.salt}', ` +
  `pw_iterations = ${pw.iterations} WHERE username = ${sqlQuote(username)};`;

console.log(yellow(`This overwrites ${username}'s password in PRODUCTION — immediate and irreversible.`));

if (await confirm('Run against the REMOTE (production) database now? [y/N] ')) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'swish', '--remote', '--command', sql], {
    stdio: 'inherit',
  });
  console.log(green(`✓ Password reset for ${username}`));
} else {
  console.log(dim('Aborted. To run it yourself:'));
  console.log(dim(`  remote: npx wrangler d1 execute swish --remote --command ${JSON.stringify(sql)}`));
  console.log(dim(`  local:  npx wrangler d1 execute swish --command ${JSON.stringify(sql)}`));
}
