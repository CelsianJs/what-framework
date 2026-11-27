// A <Link> whose href is relative ('#top', 'setup', '?tab=2') points where the
// browser resolves it: against the URL on screen, which a link that stays
// mounted across navigations (in a layout, a header) sees change. Its active
// class follows the page it points at now, as its href and a click do.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/docs/intro' });
window.scrollTo = () => {};

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { Router, Link, navigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('a relative <Link> that stays mounted', () => {
  it('is active for the page it resolves to now', async () => {
    const Page = () => h('p', null, 'page');
    const layout = ({ children }) => h('div', null,
      h('nav', null,
        h(Link, { href: '#top', id: 'top' }, 'Top'),
        h(Link, { href: 'setup', id: 'setup' }, 'Setup'),
        h(Link, { href: '/docs/setup', id: 'abs' }, 'Setup (absolute)'),
      ),
      children,
    );
    const app = document.getElementById('app');
    const unmount = mount(h(Router, { routes: [{ path: '/docs/:name', component: Page }], globalLayout: layout }), app);
    await flush();
    const cls = (id) => document.getElementById(id).getAttribute('class');
    assert.equal(cls('top'), 'active exact-active', 'on /docs/intro, #top is this page');
    assert.equal(cls('setup'), null);
    assert.equal(cls('abs'), null);

    await navigate('/docs/setup', { transition: false });
    await flush();
    assert.equal(cls('top'), 'active exact-active', '#top is the page on screen, /docs/setup');
    assert.equal(cls('setup'), 'active exact-active', 'setup resolves to /docs/setup');
    assert.equal(cls('abs'), 'active exact-active');
    unmount();
  });
});
