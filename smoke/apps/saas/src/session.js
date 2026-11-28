// Who is signed in. The server reads it from the request's cookie (each
// page's loader returns it); in the browser App keeps it in a signal that
// writes the cookie back, so the next server render (a reload, a deep link)
// sees the same visitor. The cookie is scoped to the app's base path.

import { createContext, effect, signal, useContext } from 'what-framework';

export const SESSION_COOKIE = 'ns-session';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export const Session = createContext(null);
export const useSession = () => useContext(Session);

/** The session in a Cookie header, or null. */
export function readSession(cookieHeader) {
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`).exec(cookieHeader || '');
  if (!m) return null;
  try {
    const value = JSON.parse(decodeURIComponent(m[1]));
    return value && typeof value.name === 'string' ? { name: value.name } : null;
  } catch {
    return null;
  }
}

export function createSession(initial) {
  const user = signal(initial ?? null);
  if (typeof document !== 'undefined') {
    effect(() => {
      const value = user();
      document.cookie = value === null
        ? `${SESSION_COOKIE}=; Path=${BASE}; Max-Age=0; SameSite=Lax`
        : `${SESSION_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=${BASE}; SameSite=Lax`;
    });
  }
  return {
    user,
    signIn: (name) => user.set({ name: String(name).trim() || 'Guest' }),
    signOut: () => user.set(null),
  };
}

/** A `next` target from a query string, if it is a path of this app. */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : null;
}
