// The persistent shell.
//
// Passed to <Router globalLayout={Shell}>, so it is instantiated ONCE and the
// matched page arrives as props.children, which is the router's reactive
// content thunk. Navigating swaps only that region: the sidebar, the topbar and
// the portal host below never re-mount. The smoke check proves it by stamping a
// JS property on the sidebar element and finding it still there after three
// navigations.

import { useContext } from 'what-framework';
import { Link, route } from 'what-router';

import { Workspace } from '../context.js';
import { NAV, crumbFor } from '../nav.js';
import { signOut } from '../state/session.js';
import { newOrderOpen, openNewOrder } from '../state/ui.js';
import { NewOrderModal } from '../components/NewOrderModal.jsx';
import { UserMenu } from './UserMenu.jsx';

function Sidebar() {
  return (
    <aside class="sidebar" data-sidebar>
      <div class="brand">
        <span class="brand-mark">NW</span>
        <span>
          <div class="brand-name">Northwind</div>
          <div class="brand-sub">Operations console</div>
        </span>
      </div>

      {NAV.map((group) => (
        <nav class="nav-group" key={group.label}>
          <div class="nav-label">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              class="nav-link"
              prefetch={false}
              data-nav={item.href}
            >
              <span class="dot" />
              {item.label}
              {item.tag ? <span class="nav-tag">{item.tag}</span> : null}
            </Link>
          ))}
        </nav>
      ))}

      <div class="sidebar-foot">
        <button class="ghost" data-signout onclick={signOut}>Sign out</button>
      </div>
    </aside>
  );
}

function Topbar() {
  const ws = useContext(Workspace);

  return (
    <header class="topbar" data-topbar>
      <div class="crumbs" data-crumbs>
        <span>{() => crumbFor(route.path).slice(0, -1).map((c) => `${c} / `).join('')}</span>
        <strong data-crumb-leaf>{() => crumbFor(route.path).at(-1)}</strong>
      </div>
      <div class="topbar-spacer" />
      <button class="ghost" data-new-order onclick={openNewOrder}>New order</button>
      <button
        class="icon ghost"
        data-theme-toggle
        aria-label="Toggle colour theme"
        onclick={ws.toggleTheme}
      >
        {() => (ws.theme() === 'night' ? 'Day' : 'Night')}
      </button>
      <UserMenu />
    </header>
  );
}

export function Shell(props) {
  const ws = useContext(Workspace);

  return (
    <div class={() => `shell${ws.user() ? '' : ' shell-bare'}`} data-shell>
      <Sidebar />
      <div class="main">
        <Topbar />
        <main class="content" data-outlet>{props.children}</main>
      </div>
      {() => (newOrderOpen() ? <NewOrderModal /> : null)}
    </div>
  );
}
