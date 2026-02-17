// Tests for What Framework - Accessibility Utilities
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

// jsdom does not calculate layout, so offsetParent is null by default.
Object.defineProperty(global.HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() {
    return this.parentNode;
  },
});

if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const {
  Keys,
  useId,
  useIds,
  onKey,
  onKeys,
  useFocusRestore,
  useFocusTrap,
  FocusTrap,
} = await import('../src/a11y.js');
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { signal } = await import('../src/reactive.js');

async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

describe('accessibility utilities', () => {
  describe('Keys', () => {
    it('should have standard key constants', () => {
      assert.equal(Keys.Enter, 'Enter');
      assert.equal(Keys.Space, ' ');
      assert.equal(Keys.Escape, 'Escape');
      assert.equal(Keys.Tab, 'Tab');
      assert.equal(Keys.ArrowUp, 'ArrowUp');
      assert.equal(Keys.ArrowDown, 'ArrowDown');
      assert.equal(Keys.ArrowLeft, 'ArrowLeft');
      assert.equal(Keys.ArrowRight, 'ArrowRight');
      assert.equal(Keys.Home, 'Home');
      assert.equal(Keys.End, 'End');
    });
  });

  describe('useId', () => {
    it('should generate unique IDs', () => {
      const getId1 = useId();
      const getId2 = useId();

      const id1 = getId1();
      const id2 = getId2();

      assert.notEqual(id1, id2);
      assert.ok(id1.startsWith('what-'));
      assert.ok(id2.startsWith('what-'));
    });

    it('should support custom prefix', () => {
      const getId = useId('custom');
      const id = getId();
      assert.ok(id.startsWith('custom-'));
    });
  });

  describe('useIds', () => {
    it('should generate multiple unique IDs', () => {
      const ids = useIds(3);

      assert.equal(ids.length, 3);
      assert.notEqual(ids[0], ids[1]);
      assert.notEqual(ids[1], ids[2]);
    });

    it('should support custom prefix', () => {
      const ids = useIds(2, 'form');

      assert.ok(ids[0].startsWith('form-'));
      assert.ok(ids[1].startsWith('form-'));
    });
  });

  describe('onKey', () => {
    it('should call handler when key matches', () => {
      let called = false;
      const handler = onKey('Enter', () => { called = true; });

      handler({ key: 'Enter' });
      assert.equal(called, true);
    });

    it('should not call handler when key does not match', () => {
      let called = false;
      const handler = onKey('Enter', () => { called = true; });

      handler({ key: 'Escape' });
      assert.equal(called, false);
    });
  });

  describe('onKeys', () => {
    it('should call handler when any key matches', () => {
      let called = false;
      const handler = onKeys(['Enter', ' '], () => { called = true; });

      handler({ key: ' ' });
      assert.equal(called, true);
    });

    it('should not call handler when no key matches', () => {
      let called = false;
      const handler = onKeys(['Enter', ' '], () => { called = true; });

      handler({ key: 'Tab' });
      assert.equal(called, false);
    });
  });

  describe('focus utilities', () => {
    it('useFocusRestore captures and restores focus', () => {
      const trigger = document.createElement('button');
      const other = document.createElement('button');
      document.body.appendChild(trigger);
      document.body.appendChild(other);

      trigger.focus();
      const restore = useFocusRestore();
      restore.capture();

      other.focus();
      assert.equal(document.activeElement, other);

      restore.restore();
      assert.equal(document.activeElement, trigger);

      trigger.remove();
      other.remove();
    });

    it('useFocusTrap activates, cycles tab focus, and deactivates to previous focus', () => {
      const outside = document.createElement('button');
      outside.id = 'outside';
      const container = document.createElement('div');
      const first = document.createElement('button');
      const last = document.createElement('button');

      container.appendChild(first);
      container.appendChild(last);
      document.body.appendChild(outside);
      document.body.appendChild(container);

      outside.focus();
      const trap = useFocusTrap(container);
      const stop = trap.activate();

      assert.equal(document.activeElement, first);

      last.focus();
      container.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      assert.equal(document.activeElement, first);

      stop?.();
      trap.deactivate();
      assert.equal(document.activeElement, outside);

      outside.remove();
      container.remove();
    });

    it('FocusTrap restores focus on conditional unmount', async () => {
      const app = document.getElementById('app');
      app.textContent = '';

      const open = signal(false);

      mount(
        h('div', null,
          h('button', { id: 'trigger' }, 'Trigger'),
          () => open()
            ? h(FocusTrap, { active: true },
                h('button', { id: 'inside' }, 'Inside'),
              )
            : null,
        ),
        app,
      );
      await flush();

      const trigger = app.querySelector('#trigger');
      trigger.focus();
      assert.equal(document.activeElement, trigger);

      open(true);
      await flush();
      assert.equal(document.activeElement.id, 'inside');

      open(false);
      await flush();
      assert.equal(document.activeElement, trigger);
    });
  });
});
