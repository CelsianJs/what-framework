// createStore actions, as docs/API.md (State Management) and
// docs-site/llms-full.txt (Stores) describe them. No shipped doc explained
// actions, and the source comment showed `addItem(item) { this.items.push(item); }`,
// which changes the array without a write, so nothing that reads it updates.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { createStore, derived, effect, createRoot, flushSync, mount } = await import('what-framework');

function makeTodos() {
  return createStore({
    items: [],
    remaining: derived((state) => state.items.filter((t) => !t.done).length),
    add(text) {
      this.items = [...this.items, { id: this.items.length + 1, text, done: false }];
      return this.items.length;
    },
    addTwo() {
      this.add('a');
      this.add('b');
    },
    pushInPlace(text) {
      this.items.push({ id: 0, text, done: false });
    },
    addAndCount(text) {
      this.add(text);
      return this.remaining;
    },
    writeDerived() {
      this.remaining = 99;
    },
  });
}

function watch(read) {
  const seen = [];
  createRoot(() => effect(() => { seen.push(read()); }));
  flushSync();
  return seen;
}

describe('createStore actions', () => {
  it('an assignment to a state key notifies its readers', () => {
    const todos = makeTodos()();
    const seen = watch(() => todos.remaining);
    assert.equal(todos.add('one'), 1, 'an action returns what the function returns');
    assert.deepEqual(seen, [0, 1]);
  });

  it('an in-place mutation is not a write, so no reader re-runs', () => {
    const todos = makeTodos()();
    const seen = watch(() => todos.items.length);
    todos.pushInPlace('lost');
    flushSync();
    assert.deepEqual(seen, [0]);
  });

  it('runs as one batch, with nested actions, and its effects run when it returns', () => {
    const todos = makeTodos()();
    const seen = watch(() => todos.items.length);
    todos.addTwo();
    assert.deepEqual(seen, [0, 2], 'one run, synchronously, without flushSync');
  });

  it('reads current values through this, including a derived value after a write', () => {
    const todos = makeTodos()();
    assert.equal(todos.addAndCount('x'), 1);
  });

  it('ignores an assignment to a derived key', () => {
    const todos = makeTodos()();
    todos.add('x');
    todos.writeDerived();
    assert.equal(todos.remaining, 1);
  });

  it('destructuring reads a value once; the store object stays live', () => {
    const todos = makeTodos()();
    const { remaining } = todos;
    todos.add('x');
    assert.equal(remaining, 0);
    assert.equal(todos.remaining, 1);
  });
});

describe('the documented store example', () => {
  let host;
  let unmount = () => {};
  beforeEach(() => {
    host = document.getElementById('app');
    unmount();
    host.textContent = '';
  });

  it('updates the button text when the action runs', async () => {
    const { TodoCount } = await loadCompiled(`
      import { createStore, derived } from 'what-framework';

      const useTodos = createStore({
        items: [],
        remaining: derived((state) => state.items.filter((t) => !t.done).length),
        add(text) {
          this.items = [...this.items, { id: crypto.randomUUID(), text, done: false }];
          return this.items.length;
        },
      });

      export function TodoCount() {
        const todos = useTodos();
        return <button onClick={() => todos.add('Write docs')}>{() => todos.remaining} left</button>;
      }
    `);
    unmount = mount(() => TodoCount(), host);
    const button = host.querySelector('button');
    assert.equal(button.textContent, '0 left');
    button.click();
    flushSync();
    assert.equal(button.textContent, '1 left');
  });
});
