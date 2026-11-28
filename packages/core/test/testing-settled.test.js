// what-framework/testing's settled() and act(): a test acts, waits until what
// the action started has landed (an async value it made fetch, a transition it
// opened), then reads the DOM, with no sleeps and no guessed timeouts.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h, signal, computed, startTransition, Suspense } = await import('what-framework');
const testing = await import('what-framework/testing');
const { render, cleanup, settled, act, fireEvent } = testing;

afterEach(() => cleanup());

// A request that answers after a timer, as a network does.
const later = (value, ms = 5) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('settled() from what-framework/testing', () => {
  it('is the root entry\'s settled()', async () => {
    const root = await import('what-framework');
    assert.equal(settled, root.settled);
  });

  it('resolves once an async value has landed and its <Suspense> has shown it', async () => {
    const id = signal(1);
    function Profile() {
      const user = computed(({ signal: abort }) => later(`user ${id()}`).then((v) => (abort.aborted ? null : v)));
      return h('p', { id: 'user' }, () => user());
    }
    const { container } = render(h(Suspense, { fallback: h('i', { id: 'fb' }, 'loading') }, h(Profile, {})));
    assert.ok(container.querySelector('#fb'));
    await settled();
    assert.equal(container.querySelector('#fb'), null);
    assert.equal(container.querySelector('#user').textContent, 'user 1');

    id(2);
    await settled();
    assert.equal(container.querySelector('#user').textContent, 'user 2');
  });

  it('waits for a transition to commit', async () => {
    const page = signal(1);
    function Pager() {
      const rows = computed(({ signal: abort }) => later([`row ${page()}`]).then((v) => (abort.aborted ? [] : v)));
      return h('ul', null, h('li', { id: 'page' }, () => `page ${page()}`), () => rows().map((r) => h('li', { key: r }, r)));
    }
    const { container } = render(h(Suspense, { fallback: 'loading' }, h(Pager, {})));
    await settled();
    startTransition(() => page(2));
    assert.equal(container.querySelector('#page').textContent, 'page 1', 'the transition holds the old page');
    await settled();
    assert.equal(container.querySelector('#page').textContent, 'page 2');
    assert.equal(container.querySelectorAll('li')[1].textContent, 'row 2');
  });
});

describe('act() from what-framework/testing', () => {
  it('resolves after what the action made fetch has landed', async () => {
    const query = signal('a');
    function Search() {
      const results = computed(({ signal: abort }) => later(`results for ${query()}`).then((v) => (abort.aborted ? '' : v)));
      return h('div', null,
        h('button', { id: 'go', onclick: () => query('b') }, 'go'),
        h('p', { id: 'results' }, () => results()),
      );
    }
    const { container } = render(h(Suspense, { fallback: 'loading' }, h(Search, {})));
    await settled();
    await act(() => fireEvent.click(container.querySelector('#go')));
    assert.equal(container.querySelector('#results').textContent, 'results for b');
  });
});
