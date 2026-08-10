// The sign-in gate.
//
// Deliberately in memory only. A reload signs you out, which keeps the guard
// observable on every fresh page load instead of only the first one ever.

import { signal } from 'what-framework';

export const session = signal(null, 'session');

export function signIn(name) {
  const clean = String(name || '').trim() || 'Operator';
  const handle = clean.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  session({ name: clean, email: `${handle}@northwind.ops`, role: 'Admin' });
}

export function signOut() {
  session(null);
}
