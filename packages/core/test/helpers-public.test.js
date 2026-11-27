// what-framework/dom's helpers as docs/API.md and dom.d.ts describe them:
// cls (conditional class names), style (a style object as CSS text, the text
// the framework's own style prop renders), debounce, throttle,
// useClickOutside, and what-framework/motion's transitionClass.
import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { cls, style, debounce, throttle, useClickOutside, transitionClass } = await import('../src/helpers.js');
const { h, createRoot } = await import('../src/index.js');
const { renderToString } = await import('../../server/src/index.js');

afterEach(() => mock.timers.reset());

describe('cls', () => {
  it('joins the strings and the keys whose values are truthy, skipping falsy arguments', () => {
    const off = false;
    assert.equal(cls('base', off && 'no', null, undefined, '', 'end'), 'base end');
    assert.equal(cls({ on: true, off: false, one: 1, zero: 0 }, 'x'), 'on one x');
    assert.equal(cls(), '');
  });

  it('flattens arrays, as the clsx it is modelled on does', () => {
    assert.equal(cls(['a', ['b', { c: true, d: false }]], 'e'), 'a b c e');
  });
});

describe('style', () => {
  it('passes a string through', () => {
    assert.equal(style('color: red'), 'color: red');
  });

  it('writes camelCase names in kebab-case and drops null, undefined and empty values', () => {
    assert.equal(style({ backgroundColor: 'red', fontSize: '12px', width: null, height: undefined, top: '' }), 'background-color:red;font-size:12px');
    assert.equal(style({ WebkitTransition: 'none', zIndex: 2, opacity: 0 }), '-webkit-transition:none;z-index:2;opacity:0');
  });

  it('keeps a custom property name as written, as the style prop does', () => {
    const obj = { '--mainColor': 'red', '--gap': 4, color: 'var(--mainColor)' };
    assert.equal(style(obj), '--mainColor:red;--gap:4;color:var(--mainColor)');
    assert.equal(renderToString(h('div', { style: obj })), `<div style="${style(obj)}"></div>`);
  });
});

describe('debounce', () => {
  it('calls once, with the last arguments, ms after the calls stop', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fn = debounce((...args) => calls.push(args), 100);
    fn(1);
    mock.timers.tick(50);
    fn(2, 'b');
    mock.timers.tick(99);
    assert.deepEqual(calls, []);
    mock.timers.tick(1);
    assert.deepEqual(calls, [[2, 'b']]);
    fn(3);
    mock.timers.tick(100);
    assert.deepEqual(calls, [[2, 'b'], [3]]);
  });
});

describe('throttle', () => {
  it('calls at once and then at most once per ms; a call inside the window is dropped', () => {
    mock.timers.enable({ apis: ['Date'], now: 1000 });
    const calls = [];
    const fn = throttle((x) => calls.push(x), 100);
    fn('a');
    mock.timers.tick(50);
    fn('dropped');
    mock.timers.tick(50);
    fn('b');
    assert.deepEqual(calls, ['a', 'b']);
  });
});

describe('useClickOutside', () => {
  const press = (target, type = 'mousedown') => target.dispatchEvent(new window.Event(type, { bubbles: true }));

  it('calls the handler for a press outside the element, not inside it, until its owner goes', () => {
    const inside = document.createElement('div');
    const child = document.createElement('span');
    inside.append(child);
    const outside = document.createElement('p');
    document.body.append(inside, outside);
    const seen = [];
    const dispose = createRoot((dispose) => { useClickOutside({ current: inside }, (e) => seen.push(e.type)); return dispose; });
    press(child);
    press(outside);
    press(outside, 'touchstart');
    assert.deepEqual(seen, ['mousedown', 'touchstart']);
    dispose();
    press(outside);
    assert.deepEqual(seen, ['mousedown', 'touchstart']);
    inside.remove();
    outside.remove();
  });

  it('takes the element itself', () => {
    const el = document.createElement('div');
    document.body.append(el);
    let n = 0;
    const dispose = createRoot((dispose) => { useClickOutside(el, () => n++); return dispose; });
    press(document.body);
    press(el);
    assert.equal(n, 1);
    dispose();
    el.remove();
  });

  it('ignores a press while the ref is not attached yet', () => {
    const ref = { current: null };
    let n = 0;
    const dispose = createRoot((dispose) => { useClickOutside(ref, () => n++); return dispose; });
    // An error in a listener is reported to the window, not thrown.
    const errors = [];
    const onError = (e) => { errors.push(e.error?.message ?? e.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    press(document.body);
    window.removeEventListener('error', onError);
    assert.deepEqual(errors, []);
    assert.equal(n, 0);
    ref.current = document.createElement('div');
    document.body.append(ref.current);
    press(document.body);
    assert.equal(n, 1);
    dispose();
    ref.current.remove();
  });
});

describe('transitionClass', () => {
  it('gives the enter classes while active and the leave classes otherwise', () => {
    assert.deepEqual(transitionClass('fade', true), { class: 'fade-enter fade-enter-active' });
    assert.deepEqual(transitionClass('fade', false), { class: 'fade-leave fade-leave-active' });
  });
});
