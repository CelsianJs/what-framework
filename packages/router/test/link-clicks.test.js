// A click on a <Link> is routed in the page unless the browser should take
// it: a modifier key or another button, a target other than _self, a
// download, another origin (another site, mailto:). The caller's own
// onClick runs first, and a click it prevents is not routed, as in React
// Router. Hovering a link prefetches a page of this origin, never another
// site. Before, a Link with target="_blank" or download was routed in the
// same tab, a Link to another site did nothing, a Link given an onClick lost
// its routing (the caller's handler replaced the link's, so the click loaded
// the whole document), and hovering a link to another site asked that site
// for the page.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
window.scrollTo = () => {};

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { Router, Link, route, navigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

let links = [];
const log = [];
const Page = () => h('div', null, ...links.map((props) => h(Link, props, props.id)));
const routes = [{ path: '/', component: Page }, { path: '*', component: () => h('p', { id: 'other' }, () => route.path) }];

async function click(props, init = {}) {
  links = [props];
  const app = document.getElementById('app');
  app.textContent = '';
  await navigate('/', { transition: false });
  const unmount = mount(h(Router, { routes }), app);
  await flush();
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  document.getElementById(props.id).dispatchEvent(event);
  await flush();
  const result = { routed: route.path, prevented: event.defaultPrevented };
  unmount();
  return result;
}

beforeEach(() => { log.length = 0; });

describe('a click on a <Link>', () => {
  it('routes a plain left click in the page', async () => {
    assert.deepEqual(await click({ href: '/a', id: 'plain' }), { routed: '/a', prevented: true });
    assert.deepEqual(await click({ href: '/b', id: 'self', target: '_self' }), { routed: '/b', prevented: true });
  });

  it('leaves to the browser a click with a modifier, a target, a download or another origin', async () => {
    for (const [props, init] of [
      [{ href: '/a', id: 'meta' }, { metaKey: true }],
      [{ href: '/a', id: 'blank', target: '_blank' }, {}],
      [{ href: '/file.pdf', id: 'download', download: '' }, {}],
      [{ href: 'https://example.com/x', id: 'external' }, {}],
      [{ href: 'mailto:team@example.com', id: 'mail' }, {}],
    ]) {
      // jsdom reports the document navigation it does not implement.
      const realError = console.error;
      console.error = () => {};
      try {
        assert.deepEqual(await click(props, init), { routed: '/', prevented: false }, props.id);
      } finally {
        console.error = realError;
      }
    }
  });

  it('runs the caller\'s onClick first, under any spelling, and still routes', async () => {
    assert.deepEqual(await click({ href: '/a', id: 'camel', onClick: (e) => log.push(['onClick', e.type]) }), { routed: '/a', prevented: true });
    assert.deepEqual(await click({ href: '/b', id: 'lower', onclick: () => log.push(['onclick']) }), { routed: '/b', prevented: true });
    assert.deepEqual(log, [['onClick', 'click'], ['onclick']]);
  });

  it('does not route a click the caller\'s onClick prevented', async () => {
    assert.deepEqual(await click({ href: '/a', id: 'prevented', onClick: (e) => e.preventDefault() }), { routed: '/', prevented: true });
  });

  it('runs the caller\'s onMouseEnter as well as its own prefetch, which asks only this origin', async () => {
    links = [
      { href: '/a', id: 'enter', onMouseEnter: () => log.push('enter') },
      { href: 'https://example.com/x', id: 'away' },
      { href: 'mailto:team@example.com', id: 'mailto' },
    ];
    const app = document.getElementById('app');
    app.textContent = '';
    const unmount = mount(h(Router, { routes }), app);
    await flush();
    for (const id of ['enter', 'away', 'mailto']) document.getElementById(id).dispatchEvent(new window.MouseEvent('mouseenter'));
    assert.deepEqual(log, ['enter']);
    assert.deepEqual([...document.head.querySelectorAll('link[rel=prefetch]')].map((l) => l.getAttribute('href')), ['/a']);
    unmount();
  });
});
