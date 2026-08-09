// A route's `loading:` component is a promise about THAT route. During a
// navigation the router still matched the route being left, because `_url` only
// commits once the navigation finishes, so the only `loading:` in scope belonged
// to the departing page. Declaring `loading:` on the page you were navigating TO
// could never show it.
//
// Its own file: the router keeps module-scoped URL and navigation state, so
// sharing a process with other router suites makes the starting URL and the
// in-flight flag depend on test order.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/from',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.history = dom.window.history;

const { h, mount } = await import('what-core');
const { Router, navigate, beforeNavigate } = await import('../src/index.js');

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');

describe('the loading component shown during a navigation belongs to the destination', () => {
  it('shows the destination spinner while an async guard runs', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });

    const routes = [
      { path: '/from', component: () => h('div', { id: 'from' }, 'From') },
      {
        path: '/to',
        component: () => h('div', { id: 'to' }, 'To'),
        loading: () => h('div', { id: 'to-spinner' }, 'Loading To'),
      },
    ];

    mount(h(Router, { routes }), '#app');
    await flush();
    assert.ok(app().querySelector('#from'), 'starts on the departing page');

    const off = beforeNavigate(async () => { await gate; return true; });
    const pending = navigate('/to', { transition: false });
    await flush();

    assert.ok(
      app().querySelector('#to-spinner'),
      "the destination's loading component must show, not the departing page",
    );

    release();
    await pending;
    await flush();
    off();

    assert.ok(app().querySelector('#to'), 'the destination page replaces its own spinner');
  });
});
