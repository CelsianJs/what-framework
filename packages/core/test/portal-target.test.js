// <Portal target>: an element or a selector, document.body when there is
// none. Before, a portal with no target rendered nothing and said nothing, and
// a selector that matched nothing did the same. A conditional modal mounts its
// children into the target and removes them when it closes, on the h() and
// the compiled paths.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { h, mount, signal, flushSync, Portal, Show, getDiagnostics, clearDiagnostics } = await import('../src/index.js');
const { renderToString } = await import('../../server/src/index.js');

const compiled = await loadCompiled(`
  import { Portal, Show } from 'what-framework';
  export function Modal({ open, target }) {
    return (
      <section>
        <Show when={open}>
          <Portal target={target}>
            <div role="dialog">Settings</div>
          </Portal>
        </Show>
      </section>
    );
  }
`);

const dialogs = () => [...document.querySelectorAll('[role=dialog]')];

beforeEach(() => {
  clearDiagnostics();
  for (const dialog of dialogs()) dialog.remove();
});

describe('Portal target', () => {
  for (const [path, view] of [
    ['h()', (open, target) => h('section', null, h(Show, { when: open }, h(Portal, { target }, h('div', { role: 'dialog' }, 'Settings'))))],
    ['compiled', (open, target) => h(compiled.Modal, { open, target })],
  ]) {
    it(`renders into document.body when there is none, and leaves it when the portal goes (${path})`, () => {
      const open = signal(false);
      const host = document.createElement('main');
      document.body.append(host);
      const stop = mount(view(open, undefined), host);
      try {
        assert.equal(dialogs().length, 0);
        open(true);
        flushSync();
        assert.deepEqual(dialogs().map((d) => d.parentNode), [document.body]);
        assert.equal(host.querySelector('[role=dialog]'), null);
        open(false);
        flushSync();
        assert.equal(dialogs().length, 0);
        open(true);
        flushSync();
        assert.equal(dialogs().length, 1);
      } finally {
        stop();
        host.remove();
      }
      assert.equal(dialogs().length, 0, 'unmounting removes it');
    });

    it(`renders into an element or a selector, and reports a selector that matches nothing (${path})`, () => {
      const root = document.createElement('div');
      root.id = 'modal-root';
      document.body.append(root);
      const host = document.createElement('main');
      document.body.append(host);
      try {
        for (const target of [root, '#modal-root']) {
          const stop = mount(view(signal(true), target), host);
          assert.deepEqual(dialogs().map((d) => d.parentNode), [root]);
          stop();
          assert.equal(dialogs().length, 0);
        }
        assert.deepEqual(getDiagnostics().events.map((e) => e.code), []);
        const stop = mount(view(signal(true), '#nowhere'), host);
        assert.equal(dialogs().length, 0);
        const [event] = getDiagnostics().events;
        assert.equal(event.code, 'ERR_PORTAL_TARGET_MISSING');
        assert.match(event.message, /#nowhere/);
        stop();
      } finally {
        root.remove();
        host.remove();
      }
    });
  }

  it('renders nothing on the server', () => {
    assert.equal(renderToString(h('section', null, h(Portal, null, h('div', { role: 'dialog' }, 'Settings')))), '<section></section>');
  });
});
