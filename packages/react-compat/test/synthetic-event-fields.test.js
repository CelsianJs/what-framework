// A synthetic event copies the native event's fields, but not Firefox's
// deprecated vendor fields (`mozPressure`, `mozInputSource` on MouseEvent):
// Firefox logs a deprecation warning when one is read, so copying them put
// two warnings in the console of every page whose React handler took a
// mouse event. React's synthetic event has neither field.
// Run: node --test packages/react-compat/test/synthetic-event-fields.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

// What Firefox's MouseEvent.prototype has: enumerable accessors that warn.
const reads = [];
for (const field of ['mozPressure', 'mozInputSource']) {
  Object.defineProperty(dom.window.MouseEvent.prototype, field, {
    configurable: true,
    enumerable: true,
    get() { reads.push(field); return 0; },
  });
}

const React = await import('../src/index.js');
const { createRoot } = await import('../src/dom.js');
const { flushSync } = await import('what-core');

test("a React handler's synthetic event reads no Firefox vendor field of the native event", async () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen = [];
  createRoot(el).render(React.createElement('button', { onClick: (e) => seen.push([e.type, e.clientX, e.button, 'mozPressure' in e]) }, 'go'));
  flushSync();
  el.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 7 }));
  assert.deepEqual(seen, [['click', 7, 0, false]]);
  assert.deepEqual(reads, []);
});
