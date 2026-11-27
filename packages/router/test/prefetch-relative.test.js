// A relative href ('setup') is prefetched where it resolves now: a link that
// stays mounted (in a layout) points at another page on each page, and each
// page it points at has its chunk downloaded on hover, once per page (a
// fragment does not make another page). Before, the href as written was
// prefetched once, so the second page's chunk never was.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/docs/intro' });
window.scrollTo = () => {};

const { h, mount, lazy } = await import('what-core');
const { Router, navigate, prefetch } = await import('../src/index.js');

const loads = [];
const chunk = (name) => lazy(() => {
  loads.push(name);
  return Promise.resolve({ default: () => h('h1', {}, name) });
});

mount(h(Router, {
  routes: [
    { path: '/docs/intro', component: () => h('h1', {}, 'docs intro') },
    { path: '/docs/setup', component: chunk('docs setup') },
    { path: '/guide/intro', component: () => h('h1', {}, 'guide intro') },
    { path: '/guide/setup', component: chunk('guide setup') },
  ],
}), '#app');

describe('prefetching a relative href', () => {
  it('downloads the chunk of the page it resolves to on each page, once per page', async () => {
    prefetch('setup');
    prefetch('setup#step-2');
    await navigate('/guide/intro', { transition: false });
    prefetch('setup');
    assert.deepEqual(loads, ['docs setup', 'guide setup']);
    assert.deepEqual([...document.head.querySelectorAll('link[rel=prefetch]')].map((l) => l.getAttribute('href')), ['/docs/setup', '/guide/setup']);
  });
});
