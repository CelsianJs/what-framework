// Delegated event handlers (`el.$$click`) and the one listener per root that
// dispatches them (T2-13): disabled elements, open shadow trees, slotted
// light-DOM children, an element as the delegating root, two roots delegating
// the same event, and a handler that throws. Checked in Chromium too with the
// w1 review's events-chrome.mjs; jsdom builds the same composed paths.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { delegateEvents } = await import('../src/render.js');

delegateEvents(['click']);

let container;
beforeEach(() => {
  container = document.getElementById('app');
  container.textContent = '';
});

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));

describe('delegated events', () => {
  it('runs handlers innermost first and stops on stopPropagation', () => {
    const order = [];
    const outer = document.createElement('div');
    const inner = document.createElement('span');
    outer.appendChild(inner);
    container.appendChild(outer);
    outer.$$click = () => order.push('outer');
    inner.$$click = (e) => { order.push('inner'); assert.equal(e.currentTarget, inner); };
    click(inner);
    assert.deepEqual(order, ['inner', 'outer']);

    order.length = 0;
    inner.$$click = (e) => { order.push('inner'); e.stopPropagation(); };
    click(inner);
    assert.deepEqual(order, ['inner']);
  });

  it('skips the handler of a disabled element but keeps bubbling', () => {
    const order = [];
    const form = document.createElement('form');
    const button = document.createElement('button');
    const label = document.createElement('span');
    button.appendChild(label);
    form.appendChild(button);
    container.appendChild(form);
    form.$$click = () => order.push('form');
    button.$$click = () => order.push('button');
    button.disabled = true;
    click(label);
    assert.deepEqual(order, ['form']);
    button.disabled = false;
    click(label);
    assert.deepEqual(order, ['form', 'button', 'form']);
  });

  it('reaches handlers inside an open shadow tree, with the inner target', () => {
    const host = document.createElement('div');
    container.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    shadow.appendChild(button);
    const seen = [];
    button.$$click = (e) => seen.push(['button', e.target]);
    host.$$click = (e) => seen.push(['host', e.target]);
    click(button);
    assert.deepEqual(seen, [['button', button], ['host', host]]);
  });

  it('runs each handler once when a shadow root delegates for itself too', () => {
    const host = document.createElement('div');
    container.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    delegateEvents(['click'], shadow);
    const button = document.createElement('button');
    shadow.appendChild(button);
    const seen = [];
    button.$$click = () => seen.push('button');
    host.$$click = () => seen.push('host');
    container.$$click = () => seen.push('container');
    click(button);
    assert.deepEqual(seen, ['button', 'host', 'container']);
    delete container.$$click;
  });

  it('keeps the target of a light-DOM child slotted into a shadow host', () => {
    class XCard extends window.HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<div><slot></slot></div>';
      }
    }
    if (!window.customElements.get('x-card')) window.customElements.define('x-card', XCard);
    const card = document.createElement('x-card');
    const button = document.createElement('button');
    card.appendChild(button);
    container.appendChild(card);
    const seen = [];
    card.addEventListener('click', (e) => seen.push(['native', e.target]));
    card.$$click = (e) => seen.push(['delegated', e.target]);
    click(button);
    assert.deepEqual(seen, [['native', button], ['delegated', button]]);
  });

  it('retargets once for each shadow tree the event leaves, through nested hosts', () => {
    const outer = document.createElement('div');
    container.appendChild(outer);
    const outerShadow = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    outerShadow.appendChild(inner);
    const innerShadow = inner.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    innerShadow.appendChild(button);
    const seen = [];
    button.$$click = (e) => seen.push(['button', e.target]);
    inner.$$click = (e) => seen.push(['inner', e.target]);
    outer.$$click = (e) => seen.push(['outer', e.target]);
    container.$$click = (e) => seen.push(['container', e.target]);
    click(button);
    assert.deepEqual(seen, [['button', button], ['inner', inner], ['outer', outer], ['container', outer]]);
    delete container.$$click;
  });

  it('runs the handler of an element used as the delegating root, once', () => {
    const root = document.createElement('section');
    const leaf = document.createElement('button');
    root.appendChild(leaf);
    container.appendChild(root);
    delegateEvents(['click'], root);
    const order = [];
    leaf.$$click = (e) => order.push(['leaf', e.currentTarget]);
    root.$$click = (e) => order.push(['root', e.currentTarget]);
    container.$$click = () => order.push(['container']);
    click(leaf);
    assert.deepEqual(order, [['leaf', leaf], ['root', root], ['container']]);
    order.length = 0;
    click(root);
    assert.deepEqual(order, [['root', root], ['container']]);
    delete container.$$click;
  });

  it('hands target and currentTarget back when a handler throws', () => {
    const host = document.createElement('div');
    container.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    shadow.appendChild(button);
    button.$$click = () => { throw new Error('boom'); };
    const later = [];
    const listener = (e) => later.push([e.currentTarget, e.target]);
    document.addEventListener('click', listener);
    const errors = [];
    const onError = (e) => { errors.push(e.error?.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    const event = new window.MouseEvent('click', { bubbles: true, composed: true });
    try {
      button.dispatchEvent(event);
    } finally {
      document.removeEventListener('click', listener);
      window.removeEventListener('error', onError);
    }
    assert.deepEqual(errors, ['boom']);
    assert.deepEqual(later, [[document, host]]);
    assert.equal(event.currentTarget, null);
    assert.equal(event.target, host);
  });

  it('does not register a second listener for an event already delegated', () => {
    let runs = 0;
    const el = document.createElement('div');
    container.appendChild(el);
    el.$$click = () => runs++;
    delegateEvents(['click']);
    delegateEvents(['click']);
    click(el);
    assert.equal(runs, 1);
  });
});
