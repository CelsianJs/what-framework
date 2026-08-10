// Server-only session handling. Deliberately minimal: this app exists to
// exercise the framework, not to be an auth library. The one property that
// matters here is that the gate runs on the server before any HTML exists.

const USERS = new Map([['demo@smoke.test', 'hunter2']]);
const SESSIONS = new Map(); // token -> { email }

export const SESSION_COOKIE = 'smoke_session';

function readCookie(request, name) {
  const header = request?.headers?.get?.('cookie') ?? request?.headers?.cookie ?? '';
  const match = String(header).match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionFromRequest(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return SESSIONS.get(token) ?? null;
}

export function signIn(email, password) {
  if (USERS.get(email) !== password) return null;
  const token = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  SESSIONS.set(token, { email });
  return token;
}

export function signOut(token) {
  if (token) SESSIONS.delete(token);
}
