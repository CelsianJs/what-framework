// A URL whose path starts with two slashes ('/.//x' resolves to the path
// '//x', as the address bar resolves it) is written to history as a path of
// this origin. Written as it is, '//x' is another host to history.pushState,
// which throws, and the navigation did nothing.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
window.scrollTo = () => {};

const { h, mount } = await import('what-core');
const { Router, route, navigate } = await import('../src/index.js');

const routes = [
  { path: '/', component: () => h('p', null, 'home') },
  { path: '*', component: () => h('p', { id: 'at' }, () => route.url) },
];
mount(h(Router, { routes }), document.getElementById('app'));

describe('a path that starts with two slashes', () => {
  it('is written to history as this origin\'s path, for a navigation and a fragment navigation', async () => {
    await navigate('/.//x?q=1', { transition: false });
    assert.equal(location.href, 'http://localhost//x?q=1');
    assert.equal(route.path, '//x');
    assert.equal(document.getElementById('at')?.textContent, '//x?q=1');

    await navigate('#part', { transition: false });
    assert.equal(location.href, 'http://localhost//x?q=1#part');
    assert.equal(route.hash, '#part');

    await navigate('/', { transition: false });
    assert.equal(location.pathname, '/');
  });
});
