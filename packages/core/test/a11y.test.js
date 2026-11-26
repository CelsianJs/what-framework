// Tests for What Framework - Accessibility Utilities
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM();

// jsdom does not calculate layout, so offsetParent is null by default.
Object.defineProperty(global.HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() {
    return this.parentNode;
  },
});

const {
  Keys,
  useId,
  useIds,
  useDescribedBy,
  useLabelledBy,
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
    it('returns a string, as React does, and a new one per call', () => {
      const id1 = useId();
      const id2 = useId();

      assert.equal(typeof id1, 'string');
      assert.notEqual(id1, id2);
      assert.ok(id1.startsWith('what-'));
      assert.ok(id2.startsWith('what-'));
    });

    it('should support custom prefix', () => {
      const id = useId('custom');
      assert.ok(id.startsWith('custom-'));
    });

    it('useDescribedBy and useLabelledBy hand back the id as a string', () => {
      const { descriptionId, describedByProps } = useDescribedBy('help');
      const { labelId, labelledByProps } = useLabelledBy('name');
      assert.equal(typeof descriptionId, 'string');
      assert.equal(describedByProps()['aria-describedby'], descriptionId);
      assert.equal(typeof labelId, 'string');
      assert.equal(labelledByProps()['aria-labelledby'], labelId);
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

    it('useFocusTrap makes every Tab move itself, so a browser that skips buttons cannot carry focus out', () => {
      // Safari's default Tab reaches form fields only. From the textarea, the
      // browser's own move would leave the container: the trap has to take it.
      const container = document.createElement('div');
      const close = document.createElement('button');
      const title = document.createElement('input');
      const notes = document.createElement('textarea');
      const submit = document.createElement('button');
      container.append(close, title, notes, submit);
      document.body.appendChild(container);

      const trap = useFocusTrap(container);
      const stop = trap.activate();
      const tab = (shiftKey = false) => {
        const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(event);
        return event.defaultPrevented;
      };

      const forward = [];
      for (let i = 0; i < 5; i++) forward.push([tab(), document.activeElement]);
      assert.deepEqual(forward.map(([prevented]) => prevented), [true, true, true, true, true]);
      assert.deepEqual(forward.map(([, el]) => el), [title, notes, submit, close, title]);

      notes.focus();
      assert.equal(tab(true), true);
      assert.equal(document.activeElement, title);
      close.focus();
      tab(true);
      assert.equal(document.activeElement, submit);

      stop?.();
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
