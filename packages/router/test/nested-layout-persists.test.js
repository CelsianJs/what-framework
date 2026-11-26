// A route layout shared by sibling routes stays mounted while the visitor
// moves between them, as the globalLayout does: its state, its DOM and what
// the visitor typed into it survive, and only the page inside it changes.
//
// Own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/dashboard' });

const { h, mount, signal } = await import('what-core');
const { nestedRoutes, navigate, Router } = await import('../src/index.js');

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('a nested layout persists across its child routes', () => {
  it('keeps the layout instance, its state and its DOM when moving between siblings', async () => {
    let built = 0;
    function DashboardLayout({ children }) {
      built++;
      const clicks = signal(0);
      return h('div', { id: 'layout' },
        h('button', { id: 'bump', onClick: () => clicks((c) => c + 1) }, () => `clicks ${clicks()}`),
        h('main', null, children));
    }
    const routes = nestedRoutes('/dashboard', [
      { path: '/', component: () => h('h1', null, 'Dashboard') },
      { path: '/settings', component: () => h('h1', null, 'Settings') },
    ], { layout: DashboardLayout });

    mount(h(Router, { routes }), '#app');
    await flush();
    const layoutEl = document.getElementById('layout');
    document.getElementById('bump').click();
    await flush();
    assert.equal(document.getElementById('bump').textContent, 'clicks 1');

    await navigate('/dashboard/settings');
    await flush();
    assert.equal(document.querySelector('h1').textContent, 'Settings');
    assert.equal(built, 1, 'the layout is built once for both child routes');
    assert.equal(document.getElementById('layout'), layoutEl, 'the layout keeps its DOM');
    assert.equal(document.getElementById('bump').textContent, 'clicks 1', 'the layout keeps its state');
  });

  it('builds the layout again when its params change, so its body reads the new ones', async () => {
    const seen = [];
    function ProjectLayout({ params, children }) {
      const id = params.id;
      seen.push(id);
      return h('section', { id: 'project' }, h('h2', null, `project ${id}`), children);
    }
    const routes = nestedRoutes('/projects/:id', [
      { path: '/', component: () => h('p', null, 'overview') },
      { path: '/files', component: () => h('p', null, 'files') },
    ], { layout: ProjectLayout });

    await navigate('/projects/1');
    mount(h(Router, { routes }), '#app');
    await flush();
    await navigate('/projects/1/files');
    await flush();
    assert.deepEqual(seen, ['1'], 'a sibling route under the same params keeps the layout');
    await navigate('/projects/2/files');
    await flush();
    assert.deepEqual(seen, ['1', '2']);
    assert.equal(document.querySelector('#project h2').textContent, 'project 2');
    assert.equal(document.querySelector('#project p').textContent, 'files');
  });
});
