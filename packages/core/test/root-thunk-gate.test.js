// A root render thunk that gates on a three-value signal must not duplicate the
// subtree it renders when the signal moves between two values that select the
// SAME branch.
//
// The shape comes from a real app: a boot gate reading `authStatus`, which is
// 'loading' before the session resolves and then 'authed' or 'anon'. The
// 'loading' -> 'authed' transition swaps branches, which is the easy case. The
// 'authed' -> 'anon' transition does not: the thunk re-runs, produces a
// structurally identical tree, and the reconciler has to recognise that as a
// replacement rather than an append. When it did not, the app mounted a second
// shell on top of the first, and every global singleton inside it existed twice.
//
// This did not reproduce on 0.13.3 when it was re-checked, and several
// reconciler fixes landed between the report and now (0.11.4's fragment
// fast-path among them). Nothing pinned it, which is why it is pinned here: the
// only thing worse than the bug is it coming back unnoticed because the fix was
// incidental.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { Router } = await import('../../router/src/index.js');

const root = () => document.getElementById('root');
const strip = (s) => s.replace(/<!--[^>]*-->/g, '');
const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length;

function reset() {
  document.body.innerHTML = '<div id="root"></div>';
}

describe('a root thunk gating on a three-value signal', () => {
  it('renders one subtree across a same-branch transition', () => {
    reset();
    const authStatus = signal('loading');
    const Shell = () => h('div', { id: 'shell' }, 'shell');

    mount(() => () => (authStatus() === 'loading' ? h('p', null, 'boot') : h(Shell, null)), root());
    flushSync();
    assert.equal(strip(root().innerHTML), '<p>boot</p>');

    authStatus.set('authed');
    flushSync();
    assert.equal(count(strip(root().innerHTML), 'id="shell"'), 1, 'branch swap should mount exactly one shell');

    // 'authed' -> 'anon' selects the same branch. The thunk re-runs and builds a
    // fresh Shell; the old one has to go.
    authStatus.set('anon');
    flushSync();
    assert.equal(count(strip(root().innerHTML), 'id="shell"'), 1, 'same-branch transition must not stack a second shell');
  });

  it('renders one Router across a same-branch transition', () => {
    reset();
    const authStatus = signal('loading');
    const Home = () => h('div', { id: 'home' }, 'home');
    const routes = [{ path: '/', component: Home }];

    mount(
      () => () =>
        authStatus() === 'loading'
          ? h('p', null, 'boot')
          : h('div', { id: 'shell' }, h(Router, { routes })),
      root(),
    );
    flushSync();

    authStatus.set('authed');
    flushSync();
    authStatus.set('anon');
    flushSync();

    const html = strip(root().innerHTML);
    // A Router carries app-lifetime state. Two of them is not a cosmetic
    // duplicate: it is two route subscriptions racing each other.
    assert.equal(count(html, 'id="shell"'), 1, 'same-branch transition must not stack a second shell');
    assert.equal(count(html, 'id="home"'), 1, 'same-branch transition must not stack a second Router');
  });

  it('survives repeated same-branch transitions, not just one', () => {
    reset();
    const authStatus = signal('authed');
    const Shell = () => h('div', { id: 'shell' }, 'shell');
    mount(() => () => (authStatus() === 'loading' ? h('p', null, 'boot') : h(Shell, null)), root());
    flushSync();

    for (let i = 0; i < 5; i++) {
      authStatus.set(i % 2 === 0 ? 'anon' : 'authed');
      flushSync();
    }
    assert.equal(count(strip(root().innerHTML), 'id="shell"'), 1, 'five same-branch transitions must still leave one shell');
  });
});
