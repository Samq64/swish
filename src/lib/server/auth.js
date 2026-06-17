// Authentication primitives: password hashing (PBKDF2 via WebCrypto) and
// session tokens. Cookie I/O lives in session.js (SvelteKit's `cookies`). No
// third-party dependencies.

const te = new TextEncoder();

export const COOKIE_NAME = 'swish_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
// The Cloudflare Workers runtime caps PBKDF2 at 100,000 iterations. We store
// the count per user (pw_iterations), so this can rise later if the cap does.
const PBKDF2_ITERATIONS = 100_000;

// --- base64url ---------------------------------------------------------------

export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- hashing -----------------------------------------------------------------

export async function sha256b64url(input) {
  const data = typeof input === 'string' ? te.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return b64urlEncode(new Uint8Array(digest));
}

async function deriveBits(password, salt, iterations, pepper) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    te.encode(password + (pepper || '')),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/** Returns { hash, salt, iterations } with hash+salt as base64url strings. */
export async function hashPassword(password, pepper) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS, pepper);
  return {
    hash: b64urlEncode(hash),
    salt: b64urlEncode(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

/** Constant-time verification against a stored { hash, salt, iterations }. */
export async function verifyPassword(password, stored, pepper) {
  const expected = b64urlDecode(stored.hash);
  const actual = await deriveBits(password, b64urlDecode(stored.salt), stored.iterations, pepper);
  return timingSafeEqual(actual, expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Look up a user by `column` (callers pass a literal — `'id'` or `'username'`)
 * and verify `password` against their stored credentials. Returns the row
 * (including `id`) on success, or null when the user is missing or the password
 * is wrong. Centralizes the SELECT + { hash, salt, iterations } reshaping used
 * by sign-in, change-password and delete-account.
 */
export async function verifyUserPassword(env, column, value, password) {
  const row = await env.DB.prepare(
    `SELECT id, pw_hash, pw_salt, pw_iterations FROM users WHERE ${column} = ?`,
  )
    .bind(value)
    .first();
  if (!row) return null;
  const ok = await verifyPassword(
    password,
    { hash: row.pw_hash, salt: row.pw_salt, iterations: row.pw_iterations },
    env.PEPPER,
  );
  return ok ? row : null;
}

// --- sessions ----------------------------------------------------------------

/** A fresh high-entropy session token (the raw value goes in the cookie). */
export function newSessionToken() {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}
