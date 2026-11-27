// Back/forward moves the address bar at once, and the router follows once the
// entry's route has prepared. A navigation started meanwhile supersedes it; if
// a guard then cancels that one, the page on screen stays, and so must the
// address bar: it shows the page's URL again, as a cancelled back/forward
// itself restores it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
window.scrollTo = () => {};

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { Router, route, navigate, beforeNavigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

let release = () => {};
let slow = false;
const routes = [
  { path: '/', component: () => h('p', { id: 'page' }, 'home') },
  { path: '/x', preload: () => (slow ? new Promise((resolve) => { release = resolve; }) : null), component: () => h('p', { id: 'page' }, 'x') },
  { path: '/y', component: () => h('p', { id: 'page' }, 'y') },
  { path: '/z', component: () => h('p', { id: 'page' }, 'z') },
];
mount(h(Router, { routes }), document.getElementById('app'));

describe('a back/forward still preparing', () => {
  it('superseded by a navigation a guard cancels, leaves the address bar on the page shown', async () => {
    await navigate('/x', { transition: false });
    await navigate('/y', { transition: false });
    await flush();
    slow = true;
    history.back();
    await flush();
    assert.equal(location.pathname, '/x', 'the browser moved the address bar');
    assert.equal(route.path, '/y', 'the router is preparing /x');

    const stop = beforeNavigate((to) => to !== '/z');
    try {
      await navigate('/z', { transition: false });
    } finally {
      stop();
    }
    release();
    await flush();
    assert.equal(route.path, '/y');
    assert.equal(document.getElementById('page').textContent, 'y');
    assert.equal(location.pathname, '/y', 'the address bar shows the page on screen');
    assert.equal(route.isNavigating, false);
  });

  it('a navigation a guard cancels with the address bar in step writes no history entry', async () => {
    slow = false;
    await navigate('/', { transition: false });
    const length = history.length;
    const stop = beforeNavigate(() => false);
    try {
      await navigate('/z', { transition: false });
    } finally {
      stop();
    }
    assert.equal(history.length, length);
    assert.equal(location.pathname, '/');
  });
});
