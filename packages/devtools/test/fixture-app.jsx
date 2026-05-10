import { signal, effect, mount, h, Fragment } from 'what-core';
import { __setDevToolsHooks } from 'what-core/devtools';
import { installDevTools, getSnapshot, subscribe } from 'what-devtools';
import { DevPanel } from 'what-devtools/panel';

// Install devtools first — pass core for synchronous hook setup
installDevTools({ __setDevToolsHooks });

// Create some signals for the devtools to track
const count = signal(0);
const name = signal('hello');
const items = signal([1, 2, 3]);

// Create an effect
effect(() => {
  const el = document.getElementById('count-display');
  if (el) el.textContent = `Count: ${count()}`;
});

// Simple test app. Use h() here to keep the browser test focused on devtools
// infrastructure instead of exercising JSX fragment compilation.
function App() {
  return h(Fragment, null,
    h('h1', { id: 'title' }, 'DevTools Test App'),
    h('div', { id: 'count-display' }, 'Count: 0'),
    h('button', { id: 'increment', onClick: () => count(c => c + 1) }, '+1'),
    h('button', { id: 'set-name', onClick: () => name('world') }, 'Set Name'),
    h(DevPanel),
  );
}

mount(App, '#app');

// Expose for Playwright
window.__TEST__ = { count, name, items, getSnapshot, subscribe };
