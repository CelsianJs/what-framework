// A <Link> follows its live props as an <a> follows a live attribute. In a
// layout that stays mounted while the URL moves (an org's sidebar, a
// project's tabs), `href={`/org/${params.orgId}/members`}` compiles to a
// getter: the link's href, its active class and where a click goes follow
// the new org, and so does any other live attribute it passes on
// (aria-current). Before, the link read them once and kept pointing at the
// org it was built for.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/org/acme' });
window.scrollTo = () => {};

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { signal } = await import('../../core/src/reactive.js');
const { Router, Link, route, navigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('Link with a live href', () => {
  it('follows the value its getter reads: href, active class, aria-current and the click', async () => {
    const current = signal('members');
    // As compiled JSX reads it: `params.orgId` through the layout's live props.
    const Shell = (props) => h('div', null,
      h(Link, {
        __proto__: null,
        id: 'members',
        get href() { return `/org/${props.params.orgId}/members`; },
        get 'aria-current'() { return current() === 'members' ? 'page' : undefined; },
      }, 'Members'),
      props.children);
    const routes = [
      { path: '/org/:orgId', component: () => h('p', { id: 'overview' }, () => route.params.orgId), layout: Shell },
      { path: '/org/:orgId/members', component: () => h('p', { id: 'list' }, () => `members of ${route.params.orgId}`), layout: Shell },
    ];
    mount(h(Router, { routes }), document.getElementById('app'));
    await flush();
    const link = () => document.getElementById('members');
    assert.equal(link().getAttribute('href'), '/org/acme/members');
    assert.equal(link().getAttribute('aria-current'), 'page');

    await navigate('/org/globex', { transition: false });
    current.set('overview');
    await flush();
    assert.equal(link().getAttribute('href'), '/org/globex/members', 'the href follows the new :orgId');
    assert.equal(link().getAttribute('aria-current'), null, 'a live attribute it passes on follows too');

    link().dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await flush();
    assert.equal(route.path, '/org/globex/members', 'a click goes where the href says now');
    assert.equal(document.getElementById('list').textContent, 'members of globex');
    assert.match(link().className, /\bexact-active\b/, 'the active class follows the live href');
  });
});
