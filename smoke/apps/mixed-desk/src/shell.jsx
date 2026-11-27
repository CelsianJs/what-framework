// The layout around every screen: navigation, the What context every screen
// can read, and the two toast hosts (sonner and react-toastify), which stay
// mounted while the screens come and go.

import { signal } from 'what-framework';
import { NavLink } from 'what-router';
import { Toaster } from 'sonner';
import { ToastContainer } from 'react-toastify';

import { DeskContext } from './context.js';

const NAV = [
  ['/', 'Dashboard', 'dashboard'],
  ['/deals', 'Deals', 'deals'],
  ['/forms', 'Forms', 'forms'],
  ['/overlays', 'Overlays', 'overlays'],
  ['/motion', 'Motion', 'motion'],
  ['/upload', 'Upload', 'upload'],
  ['/tools', 'Tools', 'tools'],
  ['/about', 'About', 'about'],
];

export const trader = signal('Ada');

export function Shell({ children }) {
  return (
    <DeskContext.Provider value={{ desk: 'Rates', trader }}>
      <div class="layout">
        <nav class="nav" data-nav-bar>
          <strong class="brand">Mixed Desk</strong>
          {NAV.map(([href, label, id]) => <NavLink href={href} data-nav={id}>{label}</NavLink>)}
          <label class="trader">Trader <input data-trader value={trader()} onInput={(e) => trader(e.target.value)} /></label>
        </nav>
        <main class="page" data-page>{children}</main>
        <Toaster position="bottom-right" />
        <ToastContainer position="top-right" autoClose={false} />
      </div>
    </DeskContext.Provider>
  );
}
