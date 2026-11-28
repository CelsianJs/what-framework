// The signed-in user, kept in localStorage so a reload stays signed in.

import { signal } from 'what-framework';

const KEY = 'atlas:session';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

export const session = signal(read());

export function signIn(name) {
  const user = { name: String(name).trim() };
  localStorage.setItem(KEY, JSON.stringify(user));
  session(user);
}

export function signOut() {
  localStorage.removeItem(KEY);
  session(null);
}
