// navigate() to another origin or scheme (another site, mailto:, tel:) hands
// it to the browser, as a click on a <Link> to it does: location.assign, or
// location.replace for { replace: true }. No guard runs and the route state
// stays, because the document is leaving. A redirect to another origin (a
// middleware verdict, redirect()) takes the same path, replacing the entry.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
window.scrollTo = () => {};

// jsdom's Location cannot be stubbed, and it does not implement leaving the
// document: the global the router reads records the calls instead.
const calls = [];
const real = window.location;
const recording = {
  assign: (url) => calls.push(['assign', String(url)]),
  replace: (url) => calls.push(['replace', String(url)]),
};
for (const key of ['href', 'origin', 'pathname', 'search', 'hash']) {
  Object.defineProperty(recording, key, { get: () => real[key] });
}
Object.defineProperty(globalThis, 'location', { configurable: true, value: recording });

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { Router, route, navigate, beforeNavigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const routes = [
  { path: '/', component: () => h('p', { id: 'home' }, 'home') },
  { path: '/leave', component: () => h('p', null, 'leaving'), middleware: [() => 'https://login.example/start'] },
  { path: '*', component: () => h('p', { id: 'other' }, () => route.path) },
];
mount(h(Router, { routes }), document.getElementById('app'));

beforeEach(() => { calls.length = 0; });

describe('navigate() to another origin', () => {
  it('hands it to the browser: location.assign, or location.replace with { replace: true }', async () => {
    await navigate('https://other.example/x?q=1');
    await navigate('mailto:team@example.com', { replace: true });
    await navigate('tel:+15550100');
    assert.deepEqual(calls, [
      ['assign', 'https://other.example/x?q=1'],
      ['replace', 'mailto:team@example.com'],
      ['assign', 'tel:+15550100'],
    ]);
    assert.equal(route.path, '/', 'the route state stays');
    assert.equal(route.isNavigating, false);
    assert.equal(location.pathname, '/', 'no history entry was written');
  });

  it('runs no guard for it, as a click on a <Link> to it runs none', async () => {
    const seen = [];
    const stop = beforeNavigate((to) => { seen.push(to); return false; });
    try {
      await navigate('https://other.example/');
    } finally {
      stop();
    }
    assert.deepEqual(seen, []);
    assert.deepEqual(calls, [['assign', 'https://other.example/']]);
  });

  it('still refuses an unsafe URL', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      await navigate('javascript:alert(1)');
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(calls, []);
  });

  it('routes a URL of this origin in the page', async () => {
    await navigate('http://localhost/somewhere', { transition: false });
    await flush();
    assert.deepEqual(calls, []);
    assert.equal(route.path, '/somewhere');
    assert.equal(document.getElementById('other').textContent, '/somewhere');
    await navigate('/', { transition: false });
  });

  it('follows a middleware redirect to another origin, replacing the entry', async () => {
    await navigate('/leave', { transition: false });
    await flush();
    assert.deepEqual(calls, [['replace', 'https://login.example/start']]);
  });
});
