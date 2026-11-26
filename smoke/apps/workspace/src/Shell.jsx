// The persistent shell: navigation, the user, and the toast region.

import { Link, navigate } from 'what-router';

import { session, signOut } from './state/session.js';
import { useToasts } from './state/toasts.js';

function Toasts() {
  const toasts = useToasts();
  return (
    <div class="toasts" role="status" aria-live="polite" data-toasts>
      {toasts.items.map((t) => (
        <div key={t.id} class={`toast ${t.tone}`} data-toast={t.tone}>
          <span>{t.text}</span>
          <button class="link" aria-label="Dismiss" onClick={() => toasts.dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

export function Shell({ children }) {
  return (
    <div class="shell" data-shell>
      {session() ? (
        <header class="top">
          <b>Atlas</b>
          <nav>
            <Link href="/projects" data-nav="projects">Projects</Link>
            <Link href="/new/details" data-nav="new">New project</Link>
          </nav>
          <span class="user" data-user>{session()?.name}</span>
          <button class="link" data-signout onClick={() => { signOut(); navigate('/signin'); }}>Sign out</button>
        </header>
      ) : null}
      <main data-outlet>{children}</main>
      <Toasts />
    </div>
  );
}
