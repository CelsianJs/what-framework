// An app served from a scheme of its own (Capacitor's capacitor://localhost,
// Tauri's tauri://localhost, an Electron app:// protocol, an extension page)
// goes back and forward as one served over http(s): the entry the browser
// moved to is the document's own URL, which the router shows.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/a' });
window.scrollTo = () => {};

// jsdom serves http: only: the global the router reads reports the document's
// URL on the app's own scheme.
const real = window.location;
const appScheme = {};
for (const key of ['pathname', 'search', 'hash']) {
  Object.defineProperty(appScheme, key, { get: () => real[key] });
}
Object.defineProperty(appScheme, 'href', { get: () => real.href.replace(/^http:/, 'capacitor:') });
Object.defineProperty(appScheme, 'origin', { get: () => 'null' });
Object.defineProperty(globalThis, 'location', { configurable: true, value: appScheme });

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { Router, route, navigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

const routes = [
  { path: '/a', component: () => h('p', { id: 'page' }, 'a') },
  { path: '/b', component: () => h('p', { id: 'page' }, 'b') },
];
mount(h(Router, { routes }), document.getElementById('app'));

describe('back and forward on an app scheme', () => {
  it('shows the entry the browser moved to', async () => {
    await navigate('/b', { transition: false });
    assert.equal(document.getElementById('page').textContent, 'b');
    history.back();
    await flush();
    assert.equal(real.pathname, '/a', 'the browser moved the address bar');
    assert.equal(route.path, '/a');
    assert.equal(document.getElementById('page').textContent, 'a');
    history.forward();
    await flush();
    assert.equal(route.path, '/b');
    assert.equal(document.getElementById('page').textContent, 'b');
  });
});
