// A middleware verdict with a relative target ('login') is the hop to where
// it resolves ('/account/login'): matched again while that navigation is in
// flight (its destination's `loading:` shows meanwhile), it is the same hop,
// never a redirect cycle.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/account/settings' });
window.scrollTo = () => {};

const { h, mount } = await import('what-core');
const { Router } = await import('../src/index.js');

describe('a relative middleware redirect', () => {
  it('goes where it resolves, once, with no redirect cycle', async () => {
    const errors = [];
    const { error } = console;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      mount(h(Router, {
        routes: [
          { path: '/account/settings', middleware: [() => 'login?next=settings'], component: () => h('p', null, 'settings') },
          { path: '/account/login', loading: () => h('p', null, 'loading login'), component: () => h('h1', null, 'login') },
        ],
      }), '#app');
      for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      console.error = error;
    }
    assert.equal(location.pathname + location.search, '/account/login?next=settings');
    assert.equal(document.getElementById('app').textContent, 'login');
    assert.deepEqual(errors.filter((e) => /redirect|cycle/i.test(e)), []);
  });
});
