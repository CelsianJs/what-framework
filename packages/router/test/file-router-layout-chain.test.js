// A route's `layout` list, outermost first, all wraps its page: what-compiler's
// file router gives a page every `_layout` above it (the root's, an org's,
// its projects'), and FileRouter renders each of them.
//
// Own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/org/acme/projects/apollo/issues' });

const { h, mount } = await import('what-core');
const { FileRouter, navigate } = await import('../src/index.js');

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');
const layout = (id) => ({ children }) => h('div', { id }, children);

describe('FileRouter: a page inside several _layout files', () => {
  it('renders every layout of the chain around the page, outermost first', async () => {
    const Root = layout('root');
    const Org = layout('org');
    const Projects = layout('projects');
    const routes = [
      { path: '/org/:orgId/members', component: () => h('p', { id: 'members' }, 'Members'), layout: [Root, Org], mode: 'client' },
      { path: '/org/:orgId/projects/:projectId/issues', component: () => h('p', { id: 'issues' }, 'Issues'), layout: [Root, Org, Projects], mode: 'client' },
    ];
    mount(h(FileRouter, { routes }), '#app');
    await flush();
    assert.ok(app().querySelector('#root > #org > #projects > #issues'),
      `the page sits inside root > org > projects: ${app().innerHTML}`);

    await navigate('/org/acme/members');
    await flush();
    assert.ok(app().querySelector('#root > #org > #members'), `members sits inside root > org: ${app().innerHTML}`);
    assert.equal(app().querySelector('#projects'), null, 'the projects layout is not around members');
  });
});
