import * as core from 'what-core';
import { signal, effect, mount, h } from 'what-core';
import { installDevTools } from 'what-devtools';
import { connectDevToolsMCP } from '../../src/client.js';

// Install devtools first — pass core module for synchronous hook wiring
installDevTools(core);

// Connect to MCP bridge with auth token (injected by Vite define in e2e tests)
const bridgeToken = typeof __BRIDGE_AUTH_TOKEN__ !== 'undefined' ? __BRIDGE_AUTH_TOKEN__ : '';
connectDevToolsMCP({ port: 9499, token: bridgeToken });

// Simple counter app for testing
const count = signal(0);

function Counter() {
  return h('div', {},
    h('h1', {}, 'Counter'),
    h('p', { id: 'count-display' }, () => `Count: ${count()}`),
    h('button', { onclick: () => count(count() + 1) }, 'Increment'),
  );
}

function App() {
  return h('div', { id: 'app-root' },
    h(Counter, {}),
  );
}

mount(h(App, {}), '#app');
