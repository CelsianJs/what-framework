import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'https://example.test/',
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { signal, flushSync } = await import('../src/reactive.js');

function flush() {
  flushSync();
  return new Promise(resolve => queueMicrotask(resolve));
}

describe('fresh-review DOM URL attribute hardening', () => {
  let container;

  beforeEach(() => {
    container = document.getElementById('app');
    container.textContent = '';
  });

  it('blocks unsafe href on the actual h()/mount path', async () => {
    mount(h('a', { id: 'link', href: 'java\tscript:alert(1)' }, 'bad'), container);
    await flush();

    const link = container.querySelector('#link');
    assert.equal(link.getAttribute('href'), null);
  });

  it('blocks unsafe URL attributes during reactive mount updates', async () => {
    const href = signal('/safe');
    mount(h('a', { id: 'reactive-link', href: () => href() }, 'link'), container);
    await flush();

    const link = container.querySelector('#reactive-link');
    assert.equal(link.getAttribute('href'), '/safe');

    href.set('javascript:alert(1)');
    await flush();

    assert.equal(link.getAttribute('href'), null);
  });

  it('blocks unsafe srcset candidates on the actual mount path', async () => {
    mount(h('img', { id: 'img', srcset: '/safe.png 1x, javascript:alert(1) 2x' }), container);
    await flush();

    const img = container.querySelector('#img');
    assert.equal(img.getAttribute('srcset'), null);
  });

  it('allows safe mounted URL attributes', async () => {
    mount(h('a', { id: 'safe-link', href: '/safe?x=1#hash' }, 'safe'), container);
    await flush();

    assert.equal(container.querySelector('#safe-link').getAttribute('href'), '/safe?x=1#hash');
  });
});
