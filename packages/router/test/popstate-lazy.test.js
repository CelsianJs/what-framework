// what-router declares `sideEffects: false`, but registered its popstate
// listener when the module was imported. It now registers it the first time
// the router is used (a URL read, a navigation, a <Router>, a navigation hook),
// once, and back/forward behaves as it did.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/start' });

const registered = [];
const addEventListener = window.addEventListener;
window.addEventListener = function (type, ...rest) {
  if (type === 'popstate') registered.push(type);
  return addEventListener.call(this, type, ...rest);
};

const { h, mount } = await import('what-core');
const { Router, navigate, route, afterNavigate } = await import('../src/index.js');

function settledPopstate() {
  return new Promise((resolve) => {
    addEventListener.call(window, 'popstate', () => setTimeout(resolve, 0), { once: true });
  });
}

describe('the popstate listener', () => {
  it('is not registered by importing the router', () => {
    assert.deepEqual(registered, []);
  });

  it('is registered once, by the first use of the router', async () => {
    const page = (name) => () => h('p', { id: 'page' }, name);
    mount(h(Router, { routes: [
      { path: '/start', component: page('start') },
      { path: '/a', component: page('a') },
      { path: '/b', component: page('b') },
    ] }), '#app');
    assert.equal(route.path, '/start');
    await navigate('/a', { transition: false });
    const off = afterNavigate(() => {});
    off();
    assert.deepEqual(registered, ['popstate'], 'one listener for the router, whichever use came first');
  });

  it('routes back and forward through navigate()', async () => {
    await navigate('/b', { transition: false });
    assert.equal(document.getElementById('page').textContent, 'b');

    const seen = [];
    const off = afterNavigate((to, from) => seen.push([to, from]));
    let popped = settledPopstate();
    history.back();
    await popped;
    assert.equal(route.path, '/a');
    assert.equal(document.getElementById('page').textContent, 'a');

    popped = settledPopstate();
    history.forward();
    await popped;
    off();
    assert.equal(route.path, '/b');
    assert.equal(document.getElementById('page').textContent, 'b');
    assert.deepEqual(seen, [['/a', '/b'], ['/b', '/a']]);
  });
});
