/**
 * Guest mode is signalled by a single non-secret cookie. The server-side route
 * guard (hooks.server.js) can't see localStorage, so it keys on this cookie to
 * decide whether an unauthenticated request may reach the app shell instead of
 * being bounced to /login. The cookie carries no credential — it only says
 * "this browser chose to use the app without an account". The actual guest data
 * lives in localStorage (see data/localRepository.js).
 */
export const GUEST_COOKIE = 'swish_guest';

/**
 * Enter guest mode from the client: set the marker cookie so the server guard
 * lets us into `/`. Not httpOnly (the client sets/clears it) and SameSite=Lax;
 * a year's lifetime so returning guests skip the login screen.
 */
export function setGuestCookie() {
  document.cookie = `${GUEST_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/** Leave guest mode: drop the marker cookie (the local data is left intact). */
export function clearGuestCookie() {
  document.cookie = `${GUEST_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
