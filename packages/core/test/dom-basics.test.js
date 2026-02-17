// Tests for DOM reconciler: reactive function children, memory leak disposal,
// keyed component reconciliation — the basic use cases that must never break.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

// Stub customElements if not available
if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

// Now import framework
const { signal, computed, effect, batch, flushSync } = await import('../src/reactive.js');
const { h, Fragment } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');

// Helper: flush microtask queue
async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// =========================================================================
// Reactive Function Children — Basic Use Cases
// =========================================================================

describe('reactive function children', () => {
  it('renders primitive text reactively with {() => count()}', async () => {
    const count = signal(0);
    const container = getContainer();

    mount(h('div', null, () => count()), container);
    await flush();

    assert.ok(container.textContent.includes('0'), 'initial value');

    count(5);
    await flush();
    assert.ok(container.textContent.includes('5'), 'updated value');
  });

  it('renders template string reactively with {() => `text ${val()}`}', async () => {
    const name = signal('World');
    const container = getContainer();

    mount(h('p', null, () => `Hello ${name()}`), container);
    await flush();

    assert.ok(container.textContent.includes('Hello World'));

    name('What');
    await flush();
    assert.ok(container.textContent.includes('Hello What'));
  });

  it('renders vnode arrays from .map() without [object Object]', async () => {
    const items = signal(['a', 'b', 'c']);
    const container = getContainer();

    mount(
      h('ul', null, () => items().map(item => h('li', null, item))),
      container
    );
    await flush();

    const lis = container.querySelectorAll('li');
    assert.equal(lis.length, 3);
    assert.equal(lis[0].textContent, 'a');
    assert.equal(lis[1].textContent, 'b');
    assert.equal(lis[2].textContent, 'c');

    // Must NOT contain [object Object]
    assert.ok(!container.textContent.includes('[object Object]'), 'no [object Object]');
  });

  it('updates vnode arrays reactively when signal changes', async () => {
    const items = signal([1, 2]);
    const container = getContainer();

    mount(
      h('ul', null, () => items().map(n => h('li', null, String(n)))),
      container
    );
    await flush();

    assert.equal(container.querySelectorAll('li').length, 2);

    items([1, 2, 3, 4]);
    await flush();

    const lis = container.querySelectorAll('li');
    assert.equal(lis.length, 4);
    assert.equal(lis[3].textContent, '4');
  });

  it('handles empty arrays', async () => {
    const items = signal([]);
    const container = getContainer();

    mount(
      h('div', null, () => items().map(n => h('span', null, String(n)))),
      container
    );
    await flush();

    assert.equal(container.querySelectorAll('span').length, 0);

    items([1]);
    await flush();
    assert.equal(container.querySelectorAll('span').length, 1);
  });

  it('switches between vnode and text: loading ? <Spinner/> : "Done"', async () => {
    const loading = signal(true);
    function Spinner() { return h('span', { class: 'spinner' }, 'Loading...'); }
    const container = getContainer();

    mount(
      h('div', null, () => loading() ? h(Spinner, null) : 'Done'),
      container
    );
    await flush();

    assert.ok(container.textContent.includes('Loading...'));

    loading(false);
    await flush();
    assert.ok(container.textContent.includes('Done'));
    assert.ok(!container.textContent.includes('Loading...'));
  });

  it('switches between array and single element', async () => {
    const expanded = signal(true);
    const container = getContainer();

    mount(
      h('div', null, () =>
        expanded()
          ? [h('li', null, 'A'), h('li', null, 'B'), h('li', null, 'C')]
          : h('p', null, 'Summary')
      ),
      container
    );
    await flush();

    assert.equal(container.querySelectorAll('li').length, 3);

    expanded(false);
    await flush();
    assert.equal(container.querySelectorAll('li').length, 0);
    assert.ok(container.textContent.includes('Summary'));
  });

  it('handles conditional rendering with components', async () => {
    const loggedIn = signal(false);
    function Dashboard() { return h('div', null, 'Dashboard'); }
    function Login() { return h('div', null, 'Login'); }
    const container = getContainer();

    mount(
      h('div', null, () => loggedIn() ? h(Dashboard, null) : h(Login, null)),
      container
    );
    await flush();

    assert.ok(container.textContent.includes('Login'));

    loggedIn(true);
    await flush();
    assert.ok(container.textContent.includes('Dashboard'));
    assert.ok(!container.textContent.includes('Login'));
  });

  it('handles boolean/null in arrays', async () => {
    const show = signal(false);
    const container = getContainer();

    mount(
      h('div', null, () => [
        show() ? h('header', null, 'Header') : null,
        h('main', null, 'Main'),
      ]),
      container
    );
    await flush();

    assert.ok(container.textContent.includes('Main'));
    assert.ok(!container.textContent.includes('Header'));

    show(true);
    await flush();
    assert.ok(container.textContent.includes('Header'));
    assert.ok(container.textContent.includes('Main'));
  });
});

// =========================================================================
// Memory Leak — Reactive Function Child Disposal
// =========================================================================

describe('reactive function child disposal', () => {
  it('disposes effect when parent is removed', async () => {
    const count = signal(0);
    let effectRuns = 0;
    const container = getContainer();

    // Create a reactive function child that tracks runs
    const reactiveChild = () => { effectRuns++; return `Count: ${count()}`; };

    const cleanup = mount(h('div', null, reactiveChild), container);
    await flush();

    const initialRuns = effectRuns;

    // Update signal — effect should run
    count(1);
    await flush();
    assert.ok(effectRuns > initialRuns, 'effect ran on signal change');

    const runsBeforeCleanup = effectRuns;

    // Unmount — should dispose effects
    cleanup();
    await flush();

    // Update signal again — effect should NOT run (disposed)
    count(2);
    await flush();
    assert.equal(effectRuns, runsBeforeCleanup, 'effect did not run after disposal');
  });

  it('_dispose is stored on reactive wrapper elements', async () => {
    const items = signal(['a']);
    const container = getContainer();

    mount(
      h('div', null, () => items().map(i => h('span', null, i))),
      container
    );
    await flush();

    // Find the what-c wrapper (reactive function child)
    const wrapper = container.querySelector('what-c');
    assert.ok(wrapper, 'what-c wrapper exists');
    assert.ok(typeof wrapper._dispose === 'function', '_dispose is stored on wrapper');
  });
});

// =========================================================================
// Keyed Reconciliation with Components
// =========================================================================

describe('keyed component reconciliation', () => {
  it('stores _vnode on component wrappers', async () => {
    function Item({ label }) { return h('span', null, label); }
    const container = getContainer();

    mount(h('div', null, h(Item, { label: 'test' })), container);
    await flush();

    // Component renders into a <what-c> wrapper
    const wrapper = container.querySelector('what-c');
    assert.ok(wrapper, 'component wrapper exists');
    assert.ok(wrapper._vnode, '_vnode is stored on component wrapper');
    assert.equal(wrapper._vnode.tag, Item, '_vnode.tag is the component function');
  });

  it('preserves keyed component state during reorder', async () => {
    // Each Item stores its own internal counter
    const counters = new Map();
    function Item({ id, label }) {
      if (!counters.has(id)) counters.set(id, 0);
      counters.set(id, counters.get(id) + 1);
      return h('div', { 'data-id': id }, label);
    }

    const order = signal([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ]);
    const container = getContainer();

    mount(
      h('div', null, () => order().map(item =>
        h(Item, { key: item.id, id: item.id, label: item.label })
      )),
      container
    );
    await flush();

    assert.equal(counters.get('a'), 1);
    assert.equal(counters.get('b'), 1);
    assert.equal(counters.get('c'), 1);

    // Reorder: c, a, b
    order([
      { id: 'c', label: 'Gamma' },
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ]);
    await flush();

    // With proper keyed reconciliation, components should be reused (props updated)
    // not torn down and recreated. Check DOM order.
    const divs = container.querySelectorAll('[data-id]');
    assert.equal(divs.length, 3);
    assert.equal(divs[0].getAttribute('data-id'), 'c');
    assert.equal(divs[1].getAttribute('data-id'), 'a');
    assert.equal(divs[2].getAttribute('data-id'), 'b');
  });
});

// =========================================================================
// Signal Unified Getter/Setter
// =========================================================================

describe('signal unified getter/setter', () => {
  it('reads with sig() and writes with sig(value)', () => {
    const count = signal(0);
    assert.equal(count(), 0);

    count(5);
    assert.equal(count(), 5);
  });

  it('supports updater function sig(prev => next)', () => {
    const count = signal(10);
    count(prev => prev + 5);
    assert.equal(count(), 15);
  });

  it('sig.set() still works', () => {
    const count = signal(0);
    count.set(42);
    assert.equal(count(), 42);
  });

  it('skips update when value is same (Object.is)', async () => {
    const s = signal(1);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);

    s(1); // same value
    await flush();
    assert.equal(runs, 1, 'did not re-run for same value');

    dispose();
  });
});

// =========================================================================
// Event Casing Compatibility
// =========================================================================

describe('event casing compatibility', () => {
  it('supports both onClick and onclick handlers', async () => {
    const camelClicks = signal(0);
    const lowerClicks = signal(0);
    const container = getContainer();

    mount(
      h('div', null,
        h('button', { id: 'camel', onClick: () => camelClicks(c => c + 1) }, 'Camel'),
        h('button', { id: 'lower', onclick: () => lowerClicks(c => c + 1) }, 'Lower'),
      ),
      container
    );
    await flush();

    container.querySelector('#camel').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    container.querySelector('#lower').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    assert.equal(camelClicks(), 1);
    assert.equal(lowerClicks(), 1);
  });

  it('keeps handler working when switching between onClick and onclick', async () => {
    const useLower = signal(false);
    const clicks = signal(0);
    const container = getContainer();

    function App() {
      return h(
        'button',
        useLower()
          ? { id: 'switch-case', onclick: () => clicks(c => c + 1) }
          : { id: 'switch-case', onClick: () => clicks(c => c + 1) },
        'Switch',
      );
    }

    mount(h(App), container);
    await flush();

    container.querySelector('#switch-case').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(clicks(), 1);

    useLower(true);
    await flush();

    container.querySelector('#switch-case').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(clicks(), 2);
  });
});

// =========================================================================
// innerHTML / dangerouslySetInnerHTML
// =========================================================================

describe('innerHTML props', () => {
  it('supports innerHTML as string and updates reactively', async () => {
    const html = signal('<strong>Hello</strong>');
    const container = getContainer();

    function App() {
      return h('div', { id: 'target', innerHTML: html() });
    }

    mount(h(App), container);
    await flush();

    assert.equal(container.querySelector('#target').innerHTML, '<strong>Hello</strong>');

    html('<em>Updated</em>');
    await flush();
    assert.equal(container.querySelector('#target').innerHTML, '<em>Updated</em>');
  });

  it('supports dangerouslySetInnerHTML and clears content when removed', async () => {
    const enabled = signal(true);
    const container = getContainer();

    function App() {
      return enabled()
        ? h('div', { id: 'danger', dangerouslySetInnerHTML: { __html: '<span>Unsafe</span>' } })
        : h('div', { id: 'danger' }, 'Safe');
    }

    mount(h(App), container);
    await flush();

    const target = container.querySelector('#danger');
    assert.equal(target.innerHTML, '<span>Unsafe</span>');

    enabled(false);
    await flush();
    assert.equal(target.innerHTML, 'Safe');
  });

  it('supports innerHTML on SVG elements', async () => {
    const container = getContainer();

    mount(
      h('svg', {
        id: 'svg-root',
        innerHTML: '<circle cx="5" cy="5" r="5"></circle>',
      }),
      container,
    );
    await flush();

    const svg = container.querySelector('#svg-root');
    const circle = svg.querySelector('circle');
    assert.ok(circle, 'circle should be inserted via innerHTML on svg');
  });
});
