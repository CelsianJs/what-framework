import { signal, effect, mount, __setDevToolsHooks } from 'what-core';
import { installDevTools, getSnapshot, subscribe } from 'what-devtools';
import { DevPanel } from 'what-devtools/panel';

// Install devtools first — pass core for synchronous hook setup
installDevTools({ __setDevToolsHooks });

// Create some signals for the devtools to track
const count = signal(0);
const name = signal('hello');
const items = signal([1, 2, 3]);

// Create an effect. Read count() unconditionally: the element doesn't exist
// yet at module-eval time, and an effect whose first run tracks zero signals
// is released by what-core (zero-dependency release) and never re-fires.
effect(() => {
  const value = count();
  const el = document.getElementById('count-display');
  if (el) el.textContent = `Count: ${value}`;
});

// Simple test app
// NOTE: children are wrapped in a <div> rather than a fragment — the babel
// plugin currently miscompiles top-level fragments whose element children
// carry event handlers (it references _el$N bindings it never emits).
function App() {
  return (
    <div>
      <h1 id="title">DevTools Test App</h1>
      <div id="count-display">Count: 0</div>
      <button id="increment" onclick={() => count(c => c + 1)}>+1</button>
      <button id="set-name" onclick={() => name('world')}>Set Name</button>
      <DevPanel />
    </div>
  );
}

mount(App, '#app');

// Expose for Playwright
window.__TEST__ = { count, name, items, getSnapshot, subscribe };
