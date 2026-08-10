// The deep context consumer.
//
// Nothing in this file imports the session or theme modules. Everything it
// renders arrives through <Workspace.Provider>, four component levels up
// (App -> Router -> Shell -> Topbar -> UserMenu -> UserBadge). If context stops
// reaching this depth, the badge falls back to the context DEFAULT and reads
// "no workspace", which is exactly what the smoke check looks for.

import { useContext } from 'what-framework';
import { Workspace } from '../context.js';

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}

function UserBadge() {
  const ws = useContext(Workspace);
  return (
    <div class="user-badge" data-user-badge>
      <span class="avatar" aria-hidden="true">{() => initials(ws.user()?.name ?? '?')}</span>
      <span>
        <span class="user-badge-name" data-badge-name>{() => ws.user()?.name ?? 'Signed out'}</span>
        <br />
        <span class="user-badge-meta" data-badge-meta>
          {() => `${ws.label()} · ${ws.theme()} theme`}
        </span>
      </span>
    </div>
  );
}

export function UserMenu() {
  return (
    <div class="user-menu">
      <UserBadge />
    </div>
  );
}
