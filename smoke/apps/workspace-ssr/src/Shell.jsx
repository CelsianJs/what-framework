// The persistent shell: navigation and the user.

import { Link, navigate } from 'what-router';
import { useWorkspace } from './workspace.js';

export function Shell({ children }) {
  const ws = useWorkspace();
  return (
    <div class="shell" data-shell>
      {ws.session() ? (
        <header class="top">
          <b>Atlas</b>
          <nav>
            <Link href="/projects" data-nav="projects">Projects</Link>
            <Link href="/new/details" data-nav="new">New project</Link>
          </nav>
          <span class="user" data-user>{ws.session()?.name}</span>
          <button class="link" data-signout onClick={() => { ws.signOut(); navigate('/signin'); }}>Sign out</button>
        </header>
      ) : null}
      <main data-outlet>{children}</main>
    </div>
  );
}
