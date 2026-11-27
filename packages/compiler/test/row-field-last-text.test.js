// A keyed row's field writes its text when it differs from the text it wrote
// last, as a region does, not from its node's: text something else wrote
// into the node (an extension, a test, a library) stays until the row's item
// gives the field another value.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync } = await import('what-framework');

const SOURCE = `
  import { signal } from 'what-framework';
  export const rows = signal([]);
  function Label(props) {
    return <b>{props.item.label}</b>;
  }
  export function Inline() {
    return <ul>{rows().map((row) => <li key={row.id}>{row.label}</li>)}</ul>;
  }
  export function Nested() {
    return <ul>{rows().map((row) => <li key={row.id}><Label item={row} /></li>)}</ul>;
  }
`;
const app = await loadCompiled(SOURCE);

for (const [name, cell] of [['in the row\'s template', 'li'], ['in a component of the row', 'li > b']]) {
  describe(`a keyed row's field ${name}`, () => {
    it('keeps text written into its node until its value changes', () => {
      app.rows([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const stop = mount(h(name.includes('component') ? app.Nested : app.Inline), host);
      try {
        flushSync();
        const first = host.querySelector(cell);
        first.firstChild.data = 'edited';
        app.rows([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
        flushSync();
        assert.equal(host.querySelector(cell).textContent, 'edited', 'the same label: the edit stays');
        app.rows([{ id: 1, label: 'uno' }, { id: 2, label: 'two' }]);
        flushSync();
        assert.equal(host.querySelector(cell).textContent, 'uno', 'another label is written');
        app.rows([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
        flushSync();
        assert.equal(host.querySelector(cell).textContent, 'one');
      } finally {
        stop();
        host.remove();
      }
    });
  });
}
