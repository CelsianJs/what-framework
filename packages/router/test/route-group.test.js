// routeGroup(name, routes, { layout, middleware }) groups routes without
// changing their URLs. A route it gives no middleware (none of its own and
// none from the group) has none: hovering a link to it downloads its lazy()
// chunk as for any other route, and its middleware runs only where one was
// given. Before, every grouped route got a middleware list, empty or not, so
// a hover never downloaded a grouped route's chunk.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, lazy } = await import('what-core');
const { Router, routeGroup, prefetch } = await import('../src/index.js');

const loads = [];
const chunk = (name) => lazy(() => {
  loads.push(name);
  return Promise.resolve({ default: () => h('h1', {}, name) });
});

describe('routeGroup', () => {
  it('leaves a route it gives no middleware without one, and adds the group\'s to its own', async () => {
    const seen = [];
    const own = () => { seen.push('own'); return true; };
    const group = () => { seen.push('group'); return true; };
    const open = routeGroup('docs', [{ path: '/guide', component: chunk('guide') }]);
    const guarded = routeGroup('admin', [{ path: '/admin', component: chunk('admin'), middleware: [own] }], { middleware: [group] });
    assert.equal(open[0].middleware, undefined);
    assert.equal(open[0]._group, 'docs');
    assert.deepEqual(guarded[0].middleware, [own, group]);

    mount(h(Router, { routes: [{ path: '/', component: () => h('h1', {}, 'home') }, ...open, ...guarded] }), '#app');
    prefetch('/guide');
    prefetch('/admin');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(loads, ['guide'], 'a hover downloads the grouped route with no middleware, and leaves the guarded one to its navigation');
    assert.deepEqual(seen, []);
  });
});
