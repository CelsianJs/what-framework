// Entry point. Nothing here is server-rendered: index.html ships an empty #app
// and this bundle builds the entire UI in the browser.

import './styles.css';

import { mount } from 'what-framework';
import { Router, beforeNavigate } from 'what-router';

import { Workspace } from './context.js';
import { routes } from './routes.jsx';
import { Shell } from './shell/Shell.jsx';
import { NotFound } from './pages/NotFound.jsx';
import { session } from './state/session.js';
import { theme, toggleTheme } from './state/theme.js';
import { computeRollup } from './state/reports.js';

// Preload the reports rollup before the URL commits. An awaited guard is the
// only thing that gives a destination's `loading:` component a window to be
// seen in: navigate() holds isNavigating true for as long as this hook runs.
beforeNavigate(async (to) => {
  if (to.split('?')[0].startsWith('/reports')) await computeRollup();
  return true;
});

function App() {
  // Accessors, not values. Provider destructures `value` once, so a snapshot
  // here would freeze the whole shell at whatever was true on first render.
  const workspace = {
    user: session,
    theme,
    toggleTheme,
    label: () => (session() ? `${session().name.split(' ')[0]}'s workspace` : 'no workspace'),
  };

  return (
    <Workspace.Provider value={workspace}>
      <Router routes={routes} fallback={NotFound} globalLayout={Shell} />
    </Workspace.Provider>
  );
}

mount(<App />, '#app');
