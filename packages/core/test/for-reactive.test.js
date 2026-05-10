// Tests for reactive <For> component
// Verifies: static list, adding items, removing items, reordering,
// empty array, replacing entire array, and Show reactivity.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));
global.MutationObserver = dom.window.MutationObserver;

if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { signal, effect, batch, createRoot } = await import('../src/reactive.js');
const { h, Fragment } = await import('../src/h.js');
const { mount, createDOM, disposeTree } = await import('../src/dom.js');
const { For, Show } = await import('../src/components.js');

// Helper: flush microtask queue (multiple rounds for nested effects)
async function flush() {
  for (let i = 0; i < 8; i++) {
    await new Promise(r => queueMicrotask(r));
  }
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// Helper: get visible text content from child elements (skip comment nodes)
function getItemTexts(container) {
  const texts = [];
  function walk(node) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const t = node.textContent.trim();
      if (t) texts.push(t);
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      // Get text from elements like <span>, <div>, <li>
      // For elements, just recurse into children
      for (const child of node.childNodes) {
        walk(child);
      }
    }
  }
  walk(container);
  return texts;
}

// =========================================================================
// For: Reactive List Rendering
// =========================================================================

describe('For: reactive list rendering', () => {

  it('renders a static list', async () => {
    const container = getContainer();
    const items = signal(['a', 'b', 'c']);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    const listEl = document.getElementById('list');
    const texts = getItemTexts(listEl);
    assert.deepEqual(texts, ['a', 'b', 'c'], 'static list renders correctly');
  });

  it('adds items to the list', async () => {
    const container = getContainer();
    const items = signal(['a', 'b']);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    let texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['a', 'b'], 'initial render');

    // Add an item
    items(prev => [...prev, 'c']);
    await flush();

    texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['a', 'b', 'c'], 'item added at end');

    // Add at beginning
    items(prev => ['z', ...prev]);
    await flush();

    texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['z', 'a', 'b', 'c'], 'item added at beginning');
  });

  it('removes items from the list', async () => {
    const container = getContainer();
    const items = signal(['a', 'b', 'c', 'd']);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    let texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['a', 'b', 'c', 'd'], 'initial render');

    // Remove middle item
    items(prev => prev.filter(x => x !== 'b'));
    await flush();

    texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['a', 'c', 'd'], 'middle item removed');

    // Remove first item: ['a','c','d'] -> slice(1) -> ['c','d']
    items(prev => prev.slice(1));
    await flush();

    texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['c', 'd'], 'first item removed');
  });

  it('removes items correctly step by step', async () => {
    const container = getContainer();
    const items = signal(['x', 'y', 'z']);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('list')), ['x', 'y', 'z']);

    items(['x', 'z']); // remove y
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), ['x', 'z'], 'removed y');

    items(['z']); // remove x
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), ['z'], 'removed x');

    items([]); // remove all
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), [], 'empty list');
  });

  it('handles reordering', async () => {
    const container = getContainer();
    const items = signal(['1', '2', '3']);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('list')), ['1', '2', '3']);

    // Reverse
    items(['3', '2', '1']);
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), ['3', '2', '1'], 'reversed');

    // Shuffle
    items(['2', '3', '1']);
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), ['2', '3', '1'], 'shuffled');
  });

  it('handles empty array', async () => {
    const container = getContainer();
    const items = signal([]);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items, fallback: h('span', {}, 'empty') },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    let texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['empty'], 'shows fallback for empty array');

    // Add items
    items(['hello']);
    await flush();
    texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['hello'], 'shows items after adding');

    // Back to empty
    items([]);
    await flush();
    texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['empty'], 'shows fallback again when emptied');
  });

  it('replaces entire array', async () => {
    const container = getContainer();
    const items = signal(['a', 'b', 'c']);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('list')), ['a', 'b', 'c']);

    // Replace entire array with completely different items
    items(['x', 'y']);
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), ['x', 'y'], 'completely replaced');

    // Replace with longer array
    items(['1', '2', '3', '4', '5']);
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), ['1', '2', '3', '4', '5'], 'replaced with longer');
  });

  it('renders with object items', async () => {
    const container = getContainer();
    const items = signal([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('div', {}, item.name)
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('list')), ['Alice', 'Bob']);

    // Add item
    items(prev => [...prev, { id: 3, name: 'Charlie' }]);
    await flush();
    assert.deepEqual(getItemTexts(document.getElementById('list')), ['Alice', 'Bob', 'Charlie']);
  });

  it('works with a plain array (non-signal) each prop', async () => {
    const container = getContainer();

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: ['x', 'y', 'z'] },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('list')), ['x', 'y', 'z']);
  });

  it('handles null/undefined each gracefully', async () => {
    const container = getContainer();
    const items = signal(null);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items, fallback: h('span', {}, 'nothing') },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    let texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['nothing'], 'shows fallback for null');

    // Switch to a real array
    items(['hi']);
    await flush();
    texts = getItemTexts(document.getElementById('list'));
    assert.deepEqual(texts, ['hi'], 'renders after switching from null to array');
  });

  it('handles rapid successive updates', async () => {
    const container = getContainer();
    const items = signal(['a']);

    function App() {
      return h('div', { id: 'list' },
        h(For, { each: items },
          (item) => h('span', {}, item)
        )
      );
    }

    mount(h(App), container);
    await flush();

    // Rapid updates
    items(['a', 'b']);
    items(['a', 'b', 'c']);
    items(['a', 'b', 'c', 'd']);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('list')), ['a', 'b', 'c', 'd'], 'final state after rapid updates');
  });
});

// =========================================================================
// Show: Reactive Conditional Rendering
// =========================================================================

describe('Show: reactive conditional rendering', () => {

  it('shows children when condition is true', async () => {
    const container = getContainer();
    const visible = signal(true);

    function App() {
      return h('div', { id: 'show-test' },
        h(Show, { when: visible, fallback: h('span', {}, 'hidden') },
          h('span', {}, 'visible')
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('show-test')), ['visible']);
  });

  it('reactively toggles between children and fallback', async () => {
    const container = getContainer();
    const visible = signal(true);

    function App() {
      return h('div', { id: 'show-test' },
        h(Show, { when: visible, fallback: h('span', {}, 'hidden') },
          h('span', {}, 'visible')
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('show-test')), ['visible'], 'initially visible');

    visible(false);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('show-test')), ['hidden'], 'hidden after toggle');

    visible(true);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('show-test')), ['visible'], 'visible again');
  });

  it('works with static boolean', async () => {
    const container = getContainer();

    function App() {
      return h('div', { id: 'show-test' },
        h(Show, { when: false, fallback: h('span', {}, 'nope') },
          h('span', {}, 'yes')
        )
      );
    }

    mount(h(App), container);
    await flush();

    assert.deepEqual(getItemTexts(document.getElementById('show-test')), ['nope'], 'static false shows fallback');
  });
});
