// Authentication primitives: password hashing (PBKDF2 via WebCrypto), session
// tokens, and the session cookie. No third-party dependencies.

const te = new TextEncoder();

const COOKIE_NAME = 'swish_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 floor for PBKDF2-HMAC-SHA256

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
  const actual = await deriveBits(
    password,
    b64urlDecode(stored.salt),
    stored.iterations,
    pepper,
  );
  return timingSafeEqual(actual, expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// --- sessions ----------------------------------------------------------------

/** A fresh high-entropy session token (the raw value goes in the cookie). */
export function newSessionToken() {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export { SESSION_TTL_MS };

export function readSessionCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  // Host-only (no Domain attribute); Secure is allowed on http://localhost.
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
